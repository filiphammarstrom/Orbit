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
            if let focus = store.focusTask {
                Button("Fortsätt: \(focus.title)") {
                    Task { await store.startFocus(focus) }
                }
            } else {
                Text("Inget fokus just nu")
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button("Quick Add") {
                Task { await store.quickAdd(title: "Ny uppgift från menyraden", bucket: .inbox) }
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])

            Button("Uppdatera") {
                Task { await store.refresh() }
            }
        }

        Settings {
            AppleSettingsView()
        }
    }
}
