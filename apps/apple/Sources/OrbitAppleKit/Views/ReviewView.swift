import SwiftUI

public struct ReviewView: View {
    let store: OrbitStore

    public init(store: OrbitStore) {
        self.store = store
    }

    public var body: some View {
        let waiting = store.visibleTasks.filter { $0.status == .waiting }
        let unplanned = store.visibleTasks.filter { $0.dueAt == nil && ($0.bucket == .later || $0.bucket == .someday) }

        ScrollView {
            LazyVStack(spacing: 14) {
                ReviewSection(title: "Väntar", tasks: waiting, store: store)
                ReviewSection(title: "Oplanerat", tasks: unplanned, store: store)
            }
            .padding()
        }
    }
}

private struct ReviewSection: View {
    let title: String
    let tasks: [OrbitTask]
    let store: OrbitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                Text("\(tasks.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            if tasks.isEmpty {
                Text("Inget att städa upp.")
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
            } else {
                ForEach(tasks) { task in
                    HStack {
                        Text(task.title)
                        Spacer()
                        Button("Idag") {
                            Task { await store.startFocus(task) }
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding()
                    .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
