import OrbitAppleKit
import SwiftUI

@main
struct OrbitMacApp: App {
    @State private var store = OrbitStore()

    var body: some Scene {
        WindowGroup("Orbit", id: "main") {
            OrbitRootView(store: store)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Ny uppgift") {
                    Task { await store.quickAdd(title: "Ny uppgift", bucket: .inbox) }
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }

        MenuBarExtra("Orbit", systemImage: "target") {
            MenuBarQuickAddView(store: store)

            Divider()

            if let focus = store.focusTask {
                Button("Fortsätt: \(focus.title)") {
                    Task { await store.startFocus(focus) }
                }
            } else {
                Text("Inget fokus just nu")
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button("Uppdatera") {
                Task { await store.refresh() }
            }
        }
        .menuBarExtraStyle(.window)

        Settings {
            AppleSettingsView()
        }
    }
}

private struct MenuBarQuickAddView: View {
    let store: OrbitStore
    @State private var title = ""
    @State private var notes = ""
    @State private var bucket: OrbitBucket = .inbox

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Quick Add")
                .font(.headline)

            TextField("Vad behöver göras?", text: $title)
                .textFieldStyle(.roundedBorder)
                .frame(width: 260)

            TextField("Anteckning", text: $notes)
                .textFieldStyle(.roundedBorder)
                .frame(width: 260)

            Picker("Lista", selection: $bucket) {
                ForEach(OrbitBucket.allCases) { bucket in
                    Text(bucket.title).tag(bucket)
                }
            }
            .pickerStyle(.menu)

            Button("Skapa uppgift") {
                Task {
                    await store.quickAdd(title: title, notes: notes, bucket: bucket)
                    title = ""
                    notes = ""
                    bucket = .inbox
                }
            }
            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.vertical, 6)
    }
}
