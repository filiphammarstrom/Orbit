import SwiftUI

public struct TaskListView: View {
    let title: String
    let tasks: [OrbitTask]
    let store: OrbitStore

    public init(title: String, tasks: [OrbitTask], store: OrbitStore) {
        self.title = title
        self.tasks = tasks
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)

            if tasks.isEmpty {
                ContentUnavailableView("Här är lugnt", systemImage: "checkmark.circle", description: Text("Inga öppna uppgifter i den här vyn."))
            } else {
                ForEach(tasks) { task in
                    TaskRowView(task: task, store: store)
                }
            }
        }
    }
}

private struct TaskRowView: View {
    let task: OrbitTask
    let store: OrbitStore

    var body: some View {
        HStack(spacing: 12) {
            Button {
                Task { await store.complete(task) }
            } label: {
                Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .font(.body.weight(.semibold))
                Text(task.bucket.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("P\(task.priority)")
                .font(.caption.weight(.bold))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.thinMaterial, in: Capsule())
        }
        .padding()
        .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contextMenu {
            Button("Starta fokus", systemImage: "target") {
                Task { await store.startFocus(task) }
            }
            Menu("Planera") {
                ForEach(OrbitSchedulePreset.allCases) { preset in
                    Button(preset.title) {
                        Task { await store.reschedule(task, to: preset) }
                    }
                }
            }
            Button("Klar", systemImage: "checkmark.circle") {
                Task { await store.complete(task) }
            }
        }
        .swipeActions(edge: .trailing) {
            Button("Klar") {
                Task { await store.complete(task) }
            }
            .tint(.green)

            Button("Idag") {
                Task { await store.reschedule(task, to: .today) }
            }
            .tint(.purple)
        }
    }
}
