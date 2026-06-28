import Foundation

public enum OrbitBucket: String, Codable, CaseIterable, Identifiable, Sendable {
    case inbox
    case today
    case later
    case someday

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .inbox: "Inbox"
        case .today: "Gör idag"
        case .later: "Gör sen"
        case .someday: "Gör nån gång"
        }
    }
}

public enum OrbitTaskStatus: String, Codable, CaseIterable, Sendable {
    case todo
    case planned
    case doing
    case waiting
    case review
}

public struct OrbitTask: Identifiable, Codable, Hashable, Sendable {
    public var id: UUID
    public var title: String
    public var notes: String
    public var bucket: OrbitBucket
    public var status: OrbitTaskStatus
    public var priority: Int
    public var dueAt: Date?
    public var reminderAt: Date?
    public var projectId: UUID?
    public var assigneeId: UUID?
    public var completed: Bool

    public init(
        id: UUID = UUID(),
        title: String,
        notes: String = "",
        bucket: OrbitBucket = .inbox,
        status: OrbitTaskStatus = .todo,
        priority: Int = 3,
        dueAt: Date? = nil,
        reminderAt: Date? = nil,
        projectId: UUID? = nil,
        assigneeId: UUID? = nil,
        completed: Bool = false
    ) {
        self.id = id
        self.title = title
        self.notes = notes
        self.bucket = bucket
        self.status = status
        self.priority = priority
        self.dueAt = dueAt
        self.reminderAt = reminderAt
        self.projectId = projectId
        self.assigneeId = assigneeId
        self.completed = completed
    }
}

public struct OrbitProject: Identifiable, Codable, Hashable, Sendable {
    public var id: UUID
    public var areaId: UUID
    public var name: String
    public var color: String

    public init(id: UUID = UUID(), areaId: UUID, name: String, color: String = "#7659ef") {
        self.id = id
        self.areaId = areaId
        self.name = name
        self.color = color
    }
}

public struct OrbitArea: Identifiable, Codable, Hashable, Sendable {
    public var id: UUID
    public var name: String
    public var category: String
    public var icon: String
    public var color: String

    public init(id: UUID = UUID(), name: String, category: String = "Privat", icon: String = "◫", color: String = "#7659ef") {
        self.id = id
        self.name = name
        self.category = category
        self.icon = icon
        self.color = color
    }
}

public struct OrbitWorkspaceSnapshot: Sendable {
    public var tasks: [OrbitTask]
    public var areas: [OrbitArea]
    public var projects: [OrbitProject]

    public init(tasks: [OrbitTask] = [], areas: [OrbitArea] = [], projects: [OrbitProject] = []) {
        self.tasks = tasks
        self.areas = areas
        self.projects = projects
    }
}
