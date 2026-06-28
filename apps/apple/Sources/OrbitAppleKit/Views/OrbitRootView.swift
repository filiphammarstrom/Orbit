import SwiftUI

public struct OrbitRootView: View {
    @State private var store: OrbitStore
    @State private var selectedTab: OrbitTab = .today

    public init(store: OrbitStore = OrbitStore()) {
        _store = State(initialValue: store)
    }

    public var body: some View {
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
            .task {
                await store.refresh()
            }
    }
}

public enum OrbitTab: String, CaseIterable, Identifiable {
    case today
    case inbox
    case quickAdd
    case review
    case settings

    public var id: String { rawValue }

    @MainActor
    var title: String {
        switch self {
        case .today: "Idag"
        case .inbox: "Inbox"
        case .quickAdd: "Quick Add"
        case .review: "Review"
        case .settings: "Inställningar"
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
