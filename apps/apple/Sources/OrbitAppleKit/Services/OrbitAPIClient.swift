import Foundation

public struct OrbitAPIConfiguration: Sendable {
    public var supabaseURL: URL
    public var anonKey: String
    public var accessToken: String?

    public init(supabaseURL: URL, anonKey: String, accessToken: String? = nil) {
        self.supabaseURL = supabaseURL
        self.anonKey = anonKey
        self.accessToken = accessToken
    }
}

public enum OrbitAPIError: LocalizedError, Sendable {
    case missingConfiguration
    case badResponse(Int)

    public var errorDescription: String? {
        switch self {
        case .missingConfiguration:
            "Supabase-konfiguration saknas."
        case .badResponse(let statusCode):
            "Orbit API svarade med status \(statusCode)."
        }
    }
}

public protocol OrbitAPIClient: Sendable {
    func loadWorkspace() async throws -> OrbitWorkspaceSnapshot
    func createTask(_ draft: OrbitParsedQuickAdd, notes: String) async throws -> OrbitTask
    func updateTask(_ task: OrbitTask) async throws -> OrbitTask
}

public struct SupabaseOrbitAPIClient: OrbitAPIClient {
    private let configuration: OrbitAPIConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: OrbitAPIConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder.dateEncodingStrategy = .iso8601
    }

    public func loadWorkspace() async throws -> OrbitWorkspaceSnapshot {
        async let tasks = getRows(TaskRow.self, table: "tasks")
        async let areas = getRows(AreaRow.self, table: "areas")
        async let projects = getRows(ProjectRow.self, table: "projects")
        return try await OrbitWorkspaceSnapshot(
            tasks: tasks.map(\.task),
            areas: areas.map(\.area),
            projects: projects.map(\.project)
        )
    }

    public func createTask(_ draft: OrbitParsedQuickAdd, notes: String) async throws -> OrbitTask {
        let row = CreateTaskRow(draft: draft, notes: notes)
        var request = try request(path: "/rest/v1/tasks", method: "POST")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        request.httpBody = try encoder.encode(row)
        let rows: [TaskRow] = try await perform(request)
        guard let first = rows.first else { throw OrbitAPIError.badResponse(204) }
        return first.task
    }

    public func updateTask(_ task: OrbitTask) async throws -> OrbitTask {
        var components = URLComponents()
        components.path = "/rest/v1/tasks"
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(task.id.uuidString)")]
        var request = try request(path: components.string ?? "/rest/v1/tasks", method: "PATCH")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        request.httpBody = try encoder.encode(UpdateTaskRow(task: task))
        let rows: [TaskRow] = try await perform(request)
        guard let first = rows.first else { throw OrbitAPIError.badResponse(204) }
        return first.task
    }

    private func getRows<Row: Decodable>(_ type: Row.Type, table: String) async throws -> [Row] {
        try await perform(request(path: "/rest/v1/\(table)?select=*", method: "GET"))
    }

    private func request(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: configuration.supabaseURL) else {
            throw OrbitAPIError.missingConfiguration
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(configuration.accessToken ?? configuration.anonKey)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func perform<Value: Decodable>(_ request: URLRequest) async throws -> Value {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw OrbitAPIError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        return try decoder.decode(Value.self, from: data)
    }
}

private struct TaskRow: Codable {
    var id: UUID
    var title: String
    var notes: String?
    var bucket: String?
    var status: String?
    var priority: Int?
    var due_text: String?
    var due_at: Date?
    var reminder_at: Date?
    var project_id: UUID?
    var assignee_id: UUID?
    var completed: Bool?

    var task: OrbitTask {
        OrbitTask(
            id: id,
            title: title,
            notes: notes ?? "",
            bucket: OrbitBucket(rawValue: bucket ?? "inbox") ?? .inbox,
            status: OrbitTaskStatus(rawValue: status ?? "todo") ?? .todo,
            priority: priority ?? 3,
            dueAt: due_at,
            reminderAt: reminder_at,
            dueText: due_text ?? "",
            projectId: project_id,
            assigneeId: assignee_id,
            completed: completed ?? false
        )
    }
}

private struct AreaRow: Codable {
    var id: UUID
    var name: String
    var category: String?
    var icon: String?
    var color: String?

    var area: OrbitArea {
        OrbitArea(id: id, name: name, category: category ?? "Privat", icon: icon ?? "◫", color: color ?? "#7659ef")
    }
}

private struct ProjectRow: Codable {
    var id: UUID
    var area_id: UUID
    var name: String
    var color: String?

    var project: OrbitProject {
        OrbitProject(id: id, areaId: area_id, name: name, color: color ?? "#7659ef")
    }
}

private struct CreateTaskRow: Encodable {
    var title: String
    var notes: String
    var bucket: String
    var priority: Int
    var due_text: String
    var due_at: Date?
    var reminder_at: Date?

    init(draft: OrbitParsedQuickAdd, notes: String) {
        self.title = draft.title
        self.notes = notes
        self.bucket = draft.bucket.rawValue
        self.priority = draft.priority
        self.due_text = draft.dueText
        self.due_at = draft.dueAt
        self.reminder_at = draft.reminderAt
    }
}

private struct UpdateTaskRow: Encodable {
    var title: String
    var notes: String
    var bucket: String
    var status: String
    var priority: Int
    var due_text: String
    var due_at: Date?
    var reminder_at: Date?
    var project_id: UUID?
    var assignee_id: UUID?
    var completed: Bool

    init(task: OrbitTask) {
        self.title = task.title
        self.notes = task.notes
        self.bucket = task.bucket.rawValue
        self.status = task.status.rawValue
        self.priority = task.priority
        self.due_text = task.dueText
        self.due_at = task.dueAt
        self.reminder_at = task.reminderAt
        self.project_id = task.projectId
        self.assignee_id = task.assigneeId
        self.completed = task.completed
    }
}
