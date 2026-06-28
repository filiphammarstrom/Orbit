#if canImport(AppIntents)
import AppIntents
import Foundation

@available(iOS 17.0, macOS 14.0, *)
public enum OrbitIntentBucket: String, AppEnum {
    case inbox
    case today
    case later
    case someday

    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Orbit-lista")

    public static let caseDisplayRepresentations: [OrbitIntentBucket: DisplayRepresentation] = [
        .inbox: "Inbox",
        .today: "Gör idag",
        .later: "Gör sen",
        .someday: "Gör nån gång"
    ]

    var bucket: OrbitBucket {
        switch self {
        case .inbox: .inbox
        case .today: .today
        case .later: .later
        case .someday: .someday
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct AddOrbitTaskIntent: AppIntent {
    public static let title: LocalizedStringResource = "Lägg till uppgift i Orbit"
    public static let description = IntentDescription("Skapar en ny Orbit-uppgift från Siri, Shortcuts eller en systemyta.")
    public static let openAppWhenRun = true

    @Parameter(title: "Titel")
    public var title: String

    @Parameter(title: "Lista", default: .inbox)
    public var bucket: OrbitIntentBucket

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            OrbitIntentHandoff.shared.pendingQuickAdd = PendingQuickAdd(title: title, bucket: bucket.bucket)
        }
        return .result(dialog: "Jag lägger till “\(title)” i Orbit.")
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct OpenOrbitIntent: AppIntent {
    public static let title: LocalizedStringResource = "Öppna Orbit"
    public static let description = IntentDescription("Öppnar Orbit för snabb planering.")
    public static let openAppWhenRun = true

    public init() {}

    public func perform() async throws -> some IntentResult {
        .result()
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct OrbitShortcutsProvider: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddOrbitTaskIntent(),
            phrases: [
                "Lägg till \(\.$title) i \(.applicationName)",
                "Skapa uppgift i \(.applicationName)"
            ],
            shortTitle: "Lägg till uppgift",
            systemImageName: "plus.circle"
        )

        AppShortcut(
            intent: OpenOrbitIntent(),
            phrases: [
                "Öppna \(.applicationName)"
            ],
            shortTitle: "Öppna Orbit",
            systemImageName: "target"
        )
    }
}

public struct PendingQuickAdd: Sendable {
    public var title: String
    public var bucket: OrbitBucket

    public init(title: String, bucket: OrbitBucket) {
        self.title = title
        self.bucket = bucket
    }
}

@MainActor
public final class OrbitIntentHandoff {
    public static let shared = OrbitIntentHandoff()
    public var pendingQuickAdd: PendingQuickAdd?

    private init() {}
}
#endif
