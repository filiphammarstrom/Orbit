import SwiftUI

public struct TodayView: View {
    let store: OrbitStore

    public init(store: OrbitStore) {
        self.store = store
    }

    public var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if let focusTask = store.focusTask {
                    FocusTaskCard(task: focusTask, store: store)
                }

                TaskListView(title: "Dagens steg", tasks: store.todayTasks, store: store)
            }
            .padding()
        }
        .overlay {
            if store.isLoading {
                ProgressView()
            }
        }
        .refreshable {
            await store.refresh()
        }
    }
}

private struct FocusTaskCard: View {
    let task: OrbitTask
    let store: OrbitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(task.status == .doing ? "Nuvarande fokus" : "Föreslaget fokus", systemImage: "target")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)

            Text(task.title)
                .font(.title2.weight(.bold))

            HStack {
                Button(task.status == .doing ? "Fortsätt" : "Starta fokus") {
                    Task { await store.startFocus(task) }
                }
                .buttonStyle(.borderedProminent)

                Button("Klar") {
                    Task { await store.complete(task) }
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
