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
public enum OrbitIntentDestination: String, AppEnum {
    case today
    case inbox
    case later
    case someday
    case quickAdd
    case review
    case settings

    public static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Orbit-vy")

    public static let caseDisplayRepresentations: [OrbitIntentDestination: DisplayRepresentation] = [
        .today: "Gör idag",
        .inbox: "Inbox",
        .later: "Gör sen",
        .someday: "Gör nån gång",
        .quickAdd: "Ny uppgift",
        .review: "Review",
        .settings: "Inställningar"
    ]

    var tab: OrbitTab {
        switch self {
        case .today: .today
        case .inbox: .inbox
        case .later: .later
        case .someday: .someday
        case .quickAdd: .quickAdd
        case .review: .review
        case .settings: .settings
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

    @Parameter(title: "Anteckning")
    public var notes: String?

    @Parameter(title: "Lista", default: .inbox)
    public var bucket: OrbitIntentBucket

    public init() {}

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            OrbitIntentHandoff.shared.pendingQuickAdd = PendingQuickAdd(title: title, notes: notes ?? "", bucket: bucket.bucket)
            NotificationCenter.default.post(name: .orbitIntentHandoff, object: nil)
        }
        return .result(dialog: "Jag lägger till “\(title)” i Orbit.")
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct OpenOrbitIntent: AppIntent {
    public static let title: LocalizedStringResource = "Öppna Orbit"
    public static let description = IntentDescription("Öppnar Orbit för snabb planering.")
    public static let openAppWhenRun = true

    @Parameter(title: "Vy", default: .today)
    public var destination: OrbitIntentDestination

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            OrbitIntentHandoff.shared.pendingTab = destination.tab
            NotificationCenter.default.post(name: .orbitIntentHandoff, object: nil)
        }
        return .result()
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
                "Öppna \(.applicationName)",
                "Öppna \(\.$destination) i \(.applicationName)"
            ],
            shortTitle: "Öppna Orbit",
            systemImageName: "target"
        )
    }
}

public struct PendingQuickAdd: Sendable {
    public var title: String
    public var notes: String
    public var bucket: OrbitBucket

    public init(title: String, notes: String = "", bucket: OrbitBucket) {
        self.title = title
        self.notes = notes
        self.bucket = bucket
    }
}

@MainActor
public final class OrbitIntentHandoff {
    public static let shared = OrbitIntentHandoff()
    public var pendingQuickAdd: PendingQuickAdd?
    public var pendingTab: OrbitTab?

    private init() {}
}

public extension Notification.Name {
    static let orbitIntentHandoff = Notification.Name("OrbitIntentHandoff")
}
#endif
