import Foundation
import Observation

@MainActor
@Observable
public final class OrbitStore {
    public private(set) var snapshot: OrbitWorkspaceSnapshot
    public private(set) var isLoading = false
    public var errorMessage: String?

    private let client: OrbitAPIClient?

    public init(client: OrbitAPIClient? = nil, snapshot: OrbitWorkspaceSnapshot = .preview) {
        self.client = client
        self.snapshot = snapshot
    }

    public var visibleTasks: [OrbitTask] {
        snapshot.tasks.filter { !$0.completed }
    }

    public var todayTasks: [OrbitTask] {
        visibleTasks
            .filter { $0.bucket == .today || Calendar.current.isDateInToday($0.dueAt ?? .distantPast) }
            .sorted(by: taskSort)
    }

    public var inboxTasks: [OrbitTask] {
        tasks(in: .inbox)
    }

    public var laterTasks: [OrbitTask] {
        tasks(in: .later)
    }

    public var somedayTasks: [OrbitTask] {
        tasks(in: .someday)
    }

    public func tasks(in bucket: OrbitBucket) -> [OrbitTask] {
        visibleTasks
            .filter { $0.bucket == bucket }
            .sorted(by: taskSort)
    }

    public var focusTask: OrbitTask? {
        todayTasks.first { $0.status == .doing } ?? todayTasks.first
    }

    public func refresh() async {
        guard let client else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            snapshot = try await client.loadWorkspace()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    public func quickAdd(title: String, notes: String = "", bucket fallbackBucket: OrbitBucket = .inbox) async {
        var draft = OrbitQuickAddParser.parse(title)
        if draft.bucket == .inbox {
            draft.bucket = fallbackBucket
        }
        guard !draft.title.isEmpty else { return }
        if let client {
            do {
                let task = try await client.createTask(draft, notes: notes)
                snapshot.tasks.insert(task, at: 0)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            snapshot.tasks.insert(
                OrbitTask(
                    title: draft.title,
                    notes: notes,
                    bucket: draft.bucket,
                    priority: draft.priority,
                    dueAt: draft.dueAt,
                    reminderAt: draft.reminderAt,
                    dueText: draft.dueText
                ),
                at: 0
            )
        }
    }

    public func startFocus(_ task: OrbitTask) async {
        await update(task) { draft in
            draft.bucket = .today
            draft.status = .doing
        }
    }

    public func reschedule(_ task: OrbitTask, to preset: OrbitSchedulePreset, calendar: Calendar = .current) async {
        await update(task) { draft in
            switch preset {
            case .today:
                draft.bucket = .today
                draft.dueAt = Self.day(at: 18, adding: 0, calendar: calendar)
            case .tomorrow:
                draft.bucket = .later
                draft.dueAt = Self.day(at: 9, adding: 1, calendar: calendar)
            case .nextWeek:
                draft.bucket = .later
                draft.dueAt = Self.day(at: 9, adding: 7, calendar: calendar)
            case .someday:
                draft.bucket = .someday
                draft.dueAt = nil
                draft.reminderAt = nil
            }
            draft.status = draft.status == .doing ? .doing : .planned
        }
    }

    public func complete(_ task: OrbitTask) async {
        await update(task) { draft in
            draft.completed = true
        }
    }

    private func update(_ task: OrbitTask, mutate: (inout OrbitTask) -> Void) async {
        guard let index = snapshot.tasks.firstIndex(where: { $0.id == task.id }) else { return }
        var draft = snapshot.tasks[index]
        mutate(&draft)
        if let client {
            do {
                snapshot.tasks[index] = try await client.updateTask(draft)
                errorMessage = nil
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            snapshot.tasks[index] = draft
        }
    }

    private func taskSort(_ lhs: OrbitTask, _ rhs: OrbitTask) -> Bool {
        if lhs.status == .doing, rhs.status != .doing { return true }
        if lhs.priority != rhs.priority { return lhs.priority < rhs.priority }
        return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }

    private static func day(at hour: Int, adding days: Int, calendar: Calendar) -> Date {
        let base = calendar.startOfDay(for: Date())
        let shifted = calendar.date(byAdding: .day, value: days, to: base) ?? base
        return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: shifted) ?? shifted
    }
}

public extension OrbitWorkspaceSnapshot {
    static let preview = OrbitWorkspaceSnapshot(
        tasks: [
            OrbitTask(title: "Maila Pelle om AWS", bucket: .today, status: .doing, priority: 1),
            OrbitTask(title: "Välj stereo till båten", bucket: .today, priority: 2),
            OrbitTask(title: "Fånga länk från Gmail", bucket: .inbox, priority: 3),
            OrbitTask(title: "Planera Foreshadow v1", bucket: .later, priority: 2)
        ],
        areas: [
            OrbitArea(name: "Foreshadow", category: "Bolag", icon: "✦"),
            OrbitArea(name: "Båten", category: "Privat", icon: "⚓")
        ],
        projects: []
    )
}
