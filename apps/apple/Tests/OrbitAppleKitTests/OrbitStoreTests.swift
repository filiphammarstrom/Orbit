import Foundation
import Testing
@testable import OrbitAppleKit

@MainActor
@Test func quickAddCreatesInboxTask() async {
    let store = OrbitStore(snapshot: OrbitWorkspaceSnapshot())

    await store.quickAdd(title: "Maila Pelle")

    #expect(store.inboxTasks.count == 1)
    #expect(store.inboxTasks.first?.title == "Maila Pelle")
}

@MainActor
@Test func startFocusMovesTaskToTodayAndDoing() async {
    let task = OrbitTask(title: "Välj stereo", bucket: .inbox)
    let store = OrbitStore(snapshot: OrbitWorkspaceSnapshot(tasks: [task]))

    await store.startFocus(task)

    #expect(store.todayTasks.first?.status == .doing)
    #expect(store.todayTasks.first?.bucket == .today)
}

@MainActor
@Test func rescheduleCanMoveTaskToSomeday() async {
    let task = OrbitTask(title: "Välj stereo", bucket: .today, status: .planned, dueAt: Date())
    let store = OrbitStore(snapshot: OrbitWorkspaceSnapshot(tasks: [task]))

    await store.reschedule(task, to: OrbitSchedulePreset.someday)

    #expect(store.somedayTasks.count == 1)
    #expect(store.somedayTasks.first?.dueAt == nil)
}
