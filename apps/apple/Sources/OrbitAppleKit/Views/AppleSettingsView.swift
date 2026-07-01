import SwiftUI

public struct AppleSettingsView: View {
    public init() {}

    public var body: some View {
        Form {
            Section("Apple-klient") {
                LabeledContent("Status", value: "Första native-grund")
                LabeledContent("Siri/Shortcuts", value: "App Intents-skelett")
                LabeledContent("Widgets", value: "Nästa steg")
            }

            Section("Backend") {
                Text("Den här klienten ska använda samma Supabase-projekt och samma Orbit-datamodell som webben.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
