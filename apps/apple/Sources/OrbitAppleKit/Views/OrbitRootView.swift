import SwiftUI

public struct OrbitRootView: View {
    @State private var store: OrbitStore
    @State private var selectedTab: OrbitTab = .today

    public init(store: OrbitStore = OrbitStore()) {
        _store = State(initialValue: store)
    }

    public var body: some View {
        Group {
            #if os(macOS)
            NavigationSplitView {
                OrbitSidebar(selectedTab: $selectedTab)
            } detail: {
                tabContent
                    .navigationTitle(selectedTab.title)
            }
            .frame(minWidth: 760, minHeight: 520)
            #else
            TabView(selection: $selectedTab) {
                ForEach(OrbitTab.allCases) { tab in
                    NavigationStack {
                        tab.makeContentView(store: store)
                            .navigationTitle(tab.title)
                    }
                    .tabItem { tab.label }
                    .tag(tab)
                }
            }
            #endif
        }
        .task {
            await store.refresh()
            await handleIntentHandoff()
        }
        .onReceive(NotificationCenter.default.publisher(for: .orbitIntentHandoff)) { _ in
            Task { await handleIntentHandoff() }
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        selectedTab.makeContentView(store: store)
            .toolbar {
                Button {
                    selectedTab = .quickAdd
                } label: {
                    Label("Ny uppgift", systemImage: "plus")
                }
                .keyboardShortcut("n", modifiers: [.command])
            }
    }

    private func handleIntentHandoff() async {
        if let tab = OrbitIntentHandoff.shared.pendingTab {
            OrbitIntentHandoff.shared.pendingTab = nil
            selectedTab = tab
        }
        if let quickAdd = OrbitIntentHandoff.shared.pendingQuickAdd {
            OrbitIntentHandoff.shared.pendingQuickAdd = nil
            await store.quickAdd(title: quickAdd.title, notes: quickAdd.notes, bucket: quickAdd.bucket)
            selectedTab = OrbitTab(bucket: quickAdd.bucket) ?? .inbox
        }
    }
}

public enum OrbitTab: String, CaseIterable, Identifiable {
    case today
    case inbox
    case later
    case someday
    case quickAdd
    case review
    case settings

    public var id: String { rawValue }

    @MainActor
    var title: String {
        switch self {
        case .today: "Idag"
        case .inbox: "Inbox"
        case .later: "Gör sen"
        case .someday: "Gör nån gång"
        case .quickAdd: "Quick Add"
        case .review: "Review"
        case .settings: "Inställningar"
        }
    }

    init?(bucket: OrbitBucket) {
        switch bucket {
        case .inbox: self = .inbox
        case .today: self = .today
        case .later: self = .later
        case .someday: self = .someday
        }
    }

    @ViewBuilder
    @MainActor
    func makeContentView(store: OrbitStore) -> some View {
        switch self {
        case .today:
            TodayView(store: store)
        case .inbox:
            TaskListView(title: "Inbox", tasks: store.inboxTasks, store: store)
        case .later:
            TaskListView(title: "Gör sen", tasks: store.laterTasks, store: store)
        case .someday:
            TaskListView(title: "Gör nån gång", tasks: store.somedayTasks, store: store)
        case .quickAdd:
            QuickAddView(store: store)
        case .review:
            ReviewView(store: store)
        case .settings:
            AppleSettingsView()
        }
    }

    @ViewBuilder
    @MainActor
    var label: some View {
        switch self {
        case .today: Label("Idag", systemImage: "sun.max")
        case .inbox: Label("Inbox", systemImage: "tray")
        case .later: Label("Sen", systemImage: "clock")
        case .someday: Label("Någon gång", systemImage: "shippingbox")
        case .quickAdd: Label("Ny", systemImage: "plus.circle")
        case .review: Label("Review", systemImage: "checklist")
        case .settings: Label("Mer", systemImage: "gear")
        }
    }
}

private struct OrbitSidebar: View {
    @Binding var selectedTab: OrbitTab

    var body: some View {
        List(OrbitTab.allCases, selection: $selectedTab) { tab in
            tab.label
                .tag(tab)
        }
        .listStyle(.sidebar)
        .navigationTitle("Orbit")
    }
}
