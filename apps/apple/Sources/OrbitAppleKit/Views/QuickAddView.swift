import SwiftUI

public struct QuickAddView: View {
    let store: OrbitStore
    @State private var title = ""
    @State private var notes = ""
    @State private var bucket: OrbitBucket = .inbox
    @FocusState private var titleFocused: Bool

    public init(store: OrbitStore) {
        self.store = store
    }

    public var body: some View {
        Form {
            Section("Ny uppgift") {
                TextField("Vad behöver göras?", text: $title)
                    .focused($titleFocused)
                TextField("Anteckning", text: $notes, axis: .vertical)
                Picker("Var", selection: $bucket) {
                    ForEach(OrbitBucket.allCases) { bucket in
                        Text(bucket.title).tag(bucket)
                    }
                }
            }

            Button("Skapa uppgift") {
                Task {
                    await store.quickAdd(title: title, notes: notes, bucket: bucket)
                    title = ""
                    notes = ""
                    bucket = .inbox
                    titleFocused = true
                }
            }
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .onAppear {
            titleFocused = true
        }
    }
}
