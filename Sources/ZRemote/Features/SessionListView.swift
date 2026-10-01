import Foundation
import SwiftUI
import ZRemoteCore

struct SessionListView: View {
    @Bindable var model: AppModel
    @State private var search = ""
    @State private var searching = false
    @State private var sort: SessionSort = .recent
    @State private var grouping: SessionGrouping = .project
    @State private var shownProjectID: String?
    @State private var collapsedProjects: Set<String> = []
    @State private var status: SessionStatusFilter = .all
    @State private var pullRequest: SessionPRFilter = .all
    @State private var archived: SessionArchiveFilter = .active
    @State private var created: SessionDateFilter = .any
    @State private var updated: SessionDateFilter = .any
    @State private var unreadOnly = false
    @State private var compact = true
    @State private var now = Date()
    @State private var signingOut = false
    @State private var refreshReveal: CGFloat = 0
    @FocusState private var searchFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Namespace private var searchNamespace
    #endif

    private var selectedProjectID: String? {
        shownProjectID.flatMap { selected in model.workspace.projects.contains(where: { $0.id == selected }) ? selected : nil }
    }
    private var filtered: [Session] {
        model.workspace.sessions.map { value in
            var session = value
            session.pullRequest = SessionPresentationRules.pullRequest(for: session, observed: model.preferences.pullRequests)
            return session
        }.filter { session in
            (search.isEmpty || session.title.localizedCaseInsensitiveContains(search))
                && (selectedProjectID == nil || session.projectID == selectedProjectID)
                && status.includes(session) && pullRequest.includes(session) && archived.includes(session)
                && (!unreadOnly || session.unread)
                && created.includes(session.createdAt) && updated.includes(session.updatedAt)
        }.sorted { lhs, rhs in
            if lhs.pinned != rhs.pinned { return lhs.pinned }
            switch sort {
            case .recent:
                if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
            case .created:
                if lhs.createdAt != rhs.createdAt { return lhs.createdAt > rhs.createdAt }
            case .title:
                let order = lhs.title.localizedStandardCompare(rhs.title)
                if order != .orderedSame { return order == .orderedAscending }
            }
            return lhs.id < rhs.id
        }
    }
    private var groups: [SessionSection] {
        let rows = filtered
        if let projectID = selectedProjectID {
            return [SessionSection(id: "selected-" + projectID, title: "", symbol: "", sessions: rows, showsHeader: false)]
        }
        switch grouping {
        case .none: return [SessionSection(id: "all", title: "Sessions", symbol: "clock", sessions: rows)]
        case .project:
            var sections = model.workspace.projects.map { project in
                SessionSection(id: "project-" + project.id, title: project.name, symbol: "folder", sessions: rows.filter { $0.projectID == project.id }, collapsible: true)
            }
            let known = Set(model.workspace.projects.map(\.id))
            sections.append(SessionSection(id: "unassigned", title: "Other sessions", symbol: "bubble.left",
                                           sessions: rows.filter { $0.projectID.map { !known.contains($0) } ?? true }, collapsible: true))
            return sections.filter { !$0.sessions.isEmpty }
        case .host:
            var sections = model.workspace.hosts.map { host in
                SessionSection(id: host.id, title: host.name, symbol: "desktopcomputer", sessions: rows.filter { $0.hostID == host.id })
            }
            let known = Set(model.workspace.hosts.map(\.id))
            sections.append(SessionSection(id: "other-hosts", title: "Other hosts", symbol: "desktopcomputer", sessions: rows.filter { !known.contains($0.hostID) }))
            return sections.filter { !$0.sessions.isEmpty }
        case .status:
            return SessionStatusFilter.allCases.filter { $0 != .all }.map { state in
                SessionSection(id: state.id, title: state.rawValue, symbol: state.symbol, sessions: rows.filter { state.includes($0) })
            }
                .filter { !$0.sessions.isEmpty }
        }
    }
    private var hasFilters: Bool {
        selectedProjectID != nil || status != .all || pullRequest != .all || archived != .active || unreadOnly || created != .any || updated != .any
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header.padding(.top, 12).padding(.horizontal, 16)
            refreshingList
            HStack {
                organizationMenu
                Spacer()
                Button { model.newSession() } label: {
                    Label("New session", systemImage: "square.and.pencil")
                        .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 14)
                        .foregroundStyle(Palette.background).background(Palette.text, in: Capsule())
                }.buttonStyle(.plain)
            }.padding(.bottom, 12).padding(.horizontal, 16)
        }
        .foregroundStyle(Palette.text).background(Palette.background)
        .accessibilityIdentifier("sessions-list")
        .task(id: compact) {
            guard !compact else { return }
            while !Task.isCancelled {
                now = Date()
                do { try await Task.sleep(nanoseconds: 60_000_000_000) }
                catch { return }
            }
        }
        #if os(iOS)
        .accessibilityAction(.escape) {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { model.sessionsVisible = false }
        }
        #endif
    }

    @ViewBuilder private var refreshingList: some View {
        #if os(Android)
        ComposeView {
            SessionRefreshComposer(content: sessionScroll, recess: SessionRefreshRecess(model: model),
                                   refreshing: model.refreshingSessions, hapticsEnabled: model.preferences.hapticsEnabled) {
                Task { await model.refreshSessions() }
            }
        }
        #else
        sessionScroll
            .coordinateSpace(name: "session-refresh")
            .onPreferenceChange(SessionPullPosition.self) { refreshReveal = max(0, $0) }
            .overlay(alignment: .top) {
                SessionRefreshRecess(model: model)
                    .frame(height: refreshReveal)
            }
            .clipped()
        #endif
    }

    private var sessionScroll: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 4) {
                ForEach(groups) { section in
                    if section.showsHeader { sectionHeader(section) }
                    if !section.collapsible || !collapsedProjects.contains(section.id) {
                        ForEach(section.sessions) { session in sessionRow(session).transition(.opacity) }
                    }
                }
                if filtered.isEmpty {
                    Text(search.isEmpty && !hasFilters ? "Your sessions will appear here." : "No matching sessions.")
                        .font(.subheadline).foregroundStyle(Palette.secondary).padding(.vertical, 24)
                }
            }
            .padding(.horizontal, 16)
            #if os(iOS)
            .background(NativeSessionRefresh(hapticsEnabled: model.preferences.hapticsEnabled) { await model.refreshSessions() })
            .background {
                GeometryReader { geometry in
                    Color.clear.preference(key: SessionPullPosition.self,
                                           value: geometry.frame(in: .named("session-refresh")).minY)
                }
            }
            #endif
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityAction(named: Text("Refresh sessions")) {
            Task { await model.refreshSessions() }
        }
    }

    @ViewBuilder private var header: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 14) {
                HStack(spacing: 12) {
                    if searching {
                        searchField.glassEffect(.regular.interactive(), in: Capsule())
                            .glassEffectID("session-search", in: searchNamespace)
                    } else {
                        searchButton.glassEffect(.regular.interactive(), in: Capsule())
                            .glassEffectID("session-search", in: searchNamespace)
                        Spacer(minLength: 0)
                        accountMenu
                    }
                }
            }
        } else { standardHeader }
        #else
        standardHeader
        #endif
    }
    private var standardHeader: some View {
        HStack(spacing: 12) {
            if searching { searchField.nativeGlassControl() }
            else {
                searchButton.nativeGlassControl()
                Spacer(minLength: 0)
                accountMenu
            }
        }
    }
    private var searchButton: some View {
        Button { setSearching(true) } label: {
            Image(systemName: "magnifyingglass").font(.system(size: 20))
                .frame(width: 46, height: 46).contentShape(Circle())
        }.buttonStyle(.plain).accessibilityLabel("Search sessions")
    }
    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Palette.secondary).accessibilityHidden(true)
            TextField("Search sessions", text: $search)
                .font(.subheadline).autocorrectionDisabled().focused($searchFocused).submitLabel(.search)
            Button { setSearching(false) } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .medium)).frame(width: 36, height: 44)
            }.buttonStyle(.plain).accessibilityLabel("Close search")
        }
        .padding(.leading, 16).padding(.trailing, 3).frame(height: 46)
        .task { searchFocused = true }
    }
    private func setSearching(_ value: Bool) {
        if !value { searchFocused = false; search = "" }
        withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86)) { searching = value }
    }
    @ViewBuilder private var accountMenu: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            NativeProfileMenu(avatar: avatar, name: model.workspace.profile?.displayName ?? "", signingOut: signingOut,
                              settings: { model.route = .settings }, signOut: signOut)
                .frame(width: 46, height: 46)
        } else { accountMenuControl.nativeGlassControl() }
        #else
        accountMenuControl.nativeGlassControl()
        #endif
    }
    private var accountMenuControl: some View {
        Menu {
            Button { model.route = .settings } label: { Label("Settings", systemImage: "gearshape") }
            Button(role: .destructive) {
                signOut()
            } label: {
                Text("Sign out")
            }.disabled(signingOut)
        } label: {
            avatar.frame(width: 30, height: 30).clipShape(Circle())
        }
        .frame(width: 46, height: 46)
        .accessibilityLabel(model.isDemo ? "Test mode account" : "Account")
        .accessibilityValue(model.workspace.profile?.displayName ?? "")
    }
    private func signOut() {
        guard !signingOut else { return }
        signingOut = true
        Task { await model.disconnect(); signingOut = false }
    }
    @ViewBuilder private var avatar: some View {
        if let value = model.workspace.profile?.avatarURL, let url = URL(string: value),
           url.scheme == "https", url.user == nil, url.password == nil {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initials }
        } else { initials }
    }
    private var initials: some View {
        let name = model.workspace.profile?.displayName ?? (model.isDemo ? "Test mode" : "")
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return Group {
            if letters.isEmpty { Image(systemName: "person.crop.circle").font(.system(size: 24)) }
            else { Text(letters.uppercased()).font(.subheadline.weight(.semibold)) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).foregroundStyle(Palette.text)
    }
    private var organizationMenu: some View {
        Menu {
            Menu {
                menuChoice("Show all", selected: selectedProjectID == nil) { shownProjectID = nil }
                Divider()
                ForEach(model.workspace.projects) { project in
                    menuChoice(project.name, selected: selectedProjectID == project.id) { shownProjectID = project.id }
                }
            } label: { Label("Show", systemImage: "folder") }
            Menu {
                ForEach(SessionSort.allCases) { value in menuChoice(value.rawValue, selected: sort == value) { sort = value } }
            } label: { Label("Sort", systemImage: "arrow.up.arrow.down") }
            Menu {
                Menu {
                    ForEach(SessionStatusFilter.allCases) { value in menuChoice(value.rawValue, selected: status == value) { status = value } }
                } label: { Label("Status", systemImage: "circle.dotted") }
                Menu {
                    ForEach(SessionPRFilter.allCases) { value in menuChoice(value.rawValue, selected: pullRequest == value) { pullRequest = value } }
                } label: { Label("Pull request", systemImage: "arrow.triangle.branch") }
                Menu {
                    ForEach(SessionArchiveFilter.allCases) { value in menuChoice(value.rawValue, selected: archived == value) { archived = value } }
                } label: { Label("Archived", systemImage: "archivebox") }
                Menu {
                    ForEach(SessionDateFilter.allCases) { value in menuChoice(value.rawValue, selected: created == value) { created = value } }
                } label: { Label("Created date", systemImage: "calendar") }
                Menu {
                    ForEach(SessionDateFilter.allCases) { value in menuChoice(value.rawValue, selected: updated == value) { updated = value } }
                } label: { Label("Updated date", systemImage: "calendar.badge.clock") }
                menuChoice("Unread only", selected: unreadOnly) { unreadOnly.toggle() }
                Divider()
                Button {
                    shownProjectID = nil; status = .all; pullRequest = .all; archived = .active; created = .any; updated = .any; unreadOnly = false
                } label: { Label("Reset filters", systemImage: "arrow.counterclockwise") }.disabled(!hasFilters)
            } label: { Label("Filter", systemImage: "line.3.horizontal.decrease") }
            Menu {
                ForEach(SessionGrouping.allCases) { value in menuChoice(value.rawValue, selected: grouping == value) { grouping = value } }
            } label: { Label("Group", systemImage: "square.grid.2x2") }
            Divider()
            menuChoice("Compact view", selected: compact) { compact.toggle() }
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 19)).frame(width: 46, height: 46)
                .foregroundStyle(hasFilters ? Color.white : Palette.text)
                .background(hasFilters ? Palette.accent : Color.clear, in: Circle())
                .nativeGlassControl()
        }.accessibilityLabel("Session display options").accessibilityValue(hasFilters ? "Filters active" : "")
    }
    private func menuChoice(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if selected { Label(title, systemImage: "checkmark") }
            else { Text(title) }
        }
    }
    @ViewBuilder private func sectionHeader(_ section: SessionSection) -> some View {
        if section.collapsible {
            let collapsed = collapsedProjects.contains(section.id)
            Button {
                withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.88)) {
                    if collapsed { collapsedProjects.remove(section.id) }
                    else { collapsedProjects.insert(section.id) }
                }
            } label: {
                HStack(spacing: 8) {
                    Label(section.title, systemImage: section.symbol).lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                }
                .font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                .padding(.horizontal, 10).frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain)
                .accessibilityLabel(section.title)
                .accessibilityValue(collapsed ? "Collapsed" : "Expanded")
                #if !os(Android)
                .accessibilityHint(collapsed ? "Show sessions" : "Hide sessions")
                #endif
        } else {
            Label(section.title, systemImage: section.symbol)
                .font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                .padding(.top, 14).padding(.bottom, 4).padding(.horizontal, 10)
        }
    }
    private func sessionRow(_ session: Session) -> some View {
        Button { Task { await model.open(session.id) } } label: {
            HStack(alignment: .top, spacing: 8) {
                sessionIndicator(session).frame(width: 16, height: 22).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(Palette.secondary).accessibilityHidden(true)
                        Text(session.title).font(.body.weight(session.unread ? .medium : .regular)).lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if session.pinned {
                            Image(systemName: "pin.fill").font(.system(size: 10))
                                .foregroundStyle(Palette.secondary).accessibilityHidden(true)
                        }
                        if let request = session.pullRequest { PullRequestBadge(request: request, compact: true) }
                    }
                    if !compact, let detail = SessionPresentationRules.detail(for: session, now: now) {
                        Text(detail).font(.caption).foregroundStyle(Palette.secondary).lineLimit(1)
                            .padding(.leading, 22)
                    }
                }.multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(model.selectedSessionID == session.id ? Palette.surface : .clear, in: RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .nativeContextMenu {
            Button { Task { await model.setPinned(session, pinned: !session.pinned) } } label: {
                Label(session.pinned ? "Unpin session" : "Pin session", systemImage: session.pinned ? "pin.slash" : "pin")
            }
            Button { NativeClipboard.copy(session.title) } label: { Label("Copy title", systemImage: "doc.on.doc") }
            if let request = session.pullRequest {
                Button { model.route = .pullRequest(request) } label: { Label("Pull request", systemImage: "arrow.triangle.branch") }
            }
            Divider()
            Button {
                Task {
                    if session.archived { await model.unarchive(session) }
                    else { await model.archive(session) }
                }
            } label: { Label(session.archived ? "Unarchive session" : "Archive session", systemImage: "archivebox") }
        }
        .accessibilityValue([SessionPresentationRules.indicator(for: session).accessibilityLabel,
                             session.pinned ? "Pinned" : nil, session.archived ? "Archived" : nil].compactMap { $0 }.joined(separator: ", "))
    }

    @ViewBuilder private func sessionIndicator(_ session: Session) -> some View {
        let indicator = SessionPresentationRules.indicator(for: session)
        if indicator == .working { ActivityGlyph() }
        else {
            Circle().fill(indicatorColor(indicator)).frame(width: 6, height: 6)
        }
    }

    private func indicatorColor(_ indicator: SessionIndicator) -> Color {
        switch indicator {
        case .awaitingInput: return .orange
        case .failed: return Palette.deletion
        case .unread: return .blue
        case .idle, .working: return Palette.secondary.opacity(0.5)
        }
    }
}

private struct SessionPullPosition: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct SessionSection: Identifiable {
    var id: String
    var title: String
    var symbol: String
    var sessions: [Session]
    var showsHeader = true
    var collapsible = false
}
private enum SessionSort: String, CaseIterable, Identifiable {
    case recent = "Recently updated", created = "Recently created", title = "Title"
    var id: String { rawValue }
}
private enum SessionGrouping: String, CaseIterable, Identifiable {
    case project = "Project", host = "Host", status = "Status", none = "None"
    var id: String { rawValue }
}
private enum SessionStatusFilter: String, CaseIterable, Identifiable {
    case all = "All statuses", working = "Working", awaitingInput = "Waiting for response"
    case unread = "Finished, unread", failed = "Error", idle = "Read, not running"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .all, .idle: return "circle"
        case .working: return "circle.dotted"
        case .awaitingInput: return "questionmark.bubble"
        case .unread: return "circle.fill"
        case .failed: return "exclamationmark.circle"
        }
    }
    func includes(_ session: Session) -> Bool {
        guard self != .all else { return true }
        switch SessionPresentationRules.indicator(for: session) {
        case .working: return self == .working
        case .awaitingInput: return self == .awaitingInput
        case .unread: return self == .unread
        case .failed: return self == .failed
        case .idle: return self == .idle
        }
    }
}
private enum SessionArchiveFilter: String, CaseIterable, Identifiable {
    case active = "Active", archived = "Archived", all = "All sessions"
    var id: String { rawValue }
    func includes(_ session: Session) -> Bool { self == .all || (self == .archived ? session.archived : !session.archived) }
}
private enum SessionPRFilter: String, CaseIterable, Identifiable {
    case all = "Any", withPR = "With pull request", withoutPR = "Without pull request"
    case draft = "Draft", open = "Open", merged = "Merged", closed = "Closed"
    var id: String { rawValue }
    func includes(_ session: Session) -> Bool {
        switch self {
        case .all: return true
        case .withPR: return session.pullRequest != nil
        case .withoutPR: return session.pullRequest == nil
        case .draft, .open, .merged, .closed:
            return session.pullRequest.map { PullRequestPresentationState($0).rawValue == rawValue.lowercased() } ?? false
        }
    }
}
private enum SessionDateFilter: String, CaseIterable, Identifiable {
    case any = "Any time", today = "Today", week = "Last 7 days", month = "Last 30 days"
    var id: String { rawValue }
    func includes(_ date: Date) -> Bool {
        guard self != .any else { return true }
        let days = self == .today ? 0 : self == .week ? 6 : 29
        let start = Calendar.current.startOfDay(for: Date())
        let lower = Calendar.current.date(byAdding: .day, value: -days, to: start) ?? start
        return date >= lower
    }
}
