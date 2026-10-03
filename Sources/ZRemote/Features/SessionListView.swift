import Foundation
import SkipAuthenticationServices
import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

struct SessionListView: View {
    @Bindable var model: AppModel
    @State var search = ""
    @State var searching = false
    @State var sort: SessionSort = .recent
    @State var grouping: SessionGrouping = .project
    @State var shownProjectID: String?
    @State var collapsedProjects: Set<String> = []
    @State var status: SessionStatusFilter = .all
    @State var pullRequest: SessionPRFilter = .all
    @State var archived: SessionArchiveFilter = .active
    @State var created: SessionDateFilter = .any
    @State var updated: SessionDateFilter = .any
    @State var unreadOnly = false
    @State var compact = true
    @State var now = Date()
    @State var signingOut = false
    @State var authorizingAccount = false
    @State var choosingOrganization = false
    @State var refreshReveal: CGFloat = 0
    @State var searchFocusDismissal = 0
    @State var renamingSession: Session?
    @State var renameContext = ""
    @State var renameTitle = ""
    @FocusState var searchFocused: Bool
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.webAuthenticationSession) var authentication

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
        #if os(iOS)
        .background {
            NativeSessionRenameAlert(session: $renamingSession) { session, title in
                let context = renameContext
                Task {
                    do { try await model.renameSession(sessionID: session.id, title: title, context: context) }
                    catch is CancellationError {}
                    catch { model.error = "Couldn't rename this session. Please try again." }
                }
            }.frame(width: 0, height: 0)
        }
        #else
        .alert("Rename session", isPresented: Binding(get: { renamingSession != nil }, set: { if !$0 { renamingSession = nil } })) {
            TextField("Session title", text: $renameTitle)
            Button("Cancel", role: .cancel) { renamingSession = nil }
            Button("Save") {
                guard let session = renamingSession else { return }
                let title = renameTitle
                let context = renameContext
                renamingSession = nil
                Task {
                    do { try await model.renameSession(sessionID: session.id, title: title, context: context) }
                    catch is CancellationError {}
                    catch { model.error = "Couldn't rename this session. Please try again." }
                }
            }
        }
        #endif
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
            model.sessionsVisible = false
        }
        #endif
        .confirmationDialog("Choose your organization", isPresented: $choosingOrganization, titleVisibility: .visible) {
            ForEach(model.organizations) { organization in
                Button(organization.name) { Task { await model.chooseOrganization(organization.id) } }
            }
            Button("Cancel", role: .cancel) { model.organizations = [] }
        }
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
            .overlay(alignment: .top) {
                SessionRefreshRecess(model: model)
                    .frame(height: refreshReveal)
            }
            .clipped()
        #endif
    }

    private var sessionScroll: some View {
        ScrollView {
            #if os(iOS)
            // Keep the UIKit attachment outside lazy content so filtering and
            // offscreen row recycling cannot remove the refresh owner.
            VStack(spacing: 0) {
                NativeSessionRefresh(hapticsEnabled: model.preferences.hapticsEnabled,
                                     onRevealChange: { height in
                                         withTransaction(Transaction(animation: nil)) { refreshReveal = height }
                                     }) {
                    await model.refreshSessions()
                }.frame(height: 0)
                sessionRows
            }
            #else
            sessionRows
            #endif
        }
        #if os(iOS)
        .scrollBounceBehavior(.always, axes: .vertical)
        #endif
        .scrollDismissesKeyboard(.interactively)
        .accessibilityAction(named: Text("Refresh sessions")) {
            Task { await model.refreshSessions() }
        }
    }

    private var sessionRows: some View {
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
        .padding(.horizontal, 16).padding(.top, selectedProjectID == nil ? 0 : 14)
    }

    private var header: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                accountMenu
                    .frame(width: searching ? 0 : 46, height: 46)
                    .opacity(searching ? 0 : 1)
                    .allowsHitTesting(!searching)
                    .accessibilityHidden(searching)
                Spacer(minLength: 0)
                searchControl(expandedWidth: max(46, geometry.size.width))
            }
        }
        .frame(height: 46)
        .animation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.92), value: searching)
        .task(id: [searching && model.sessionsVisible && model.route == nil, reduceMotion]) {
            guard searching, model.sessionsVisible, model.route == nil else { dismissSearchFocus(); return }
            // Let the capsule widen before the keyboard changes the drawer's
            // layout. A newer focus request or dismissal cancels this task.
            if !reduceMotion {
                do { try await Task.sleep(nanoseconds: 220_000_000) }
                catch { return }
            } else { await Task.yield() }
            guard !Task.isCancelled, searching, model.sessionsVisible, model.route == nil else { return }
            searchFocused = true
        }
        #if os(Android)
        .composeModifier { AndroidQuestionFocusModifier(dismissal: searchFocusDismissal) }
        #endif
        .onDisappear { dismissSearchFocus() }
    }
    @ViewBuilder private func searchControl(expandedWidth: CGFloat) -> some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            searchContents(expandedWidth: expandedWidth).glassEffect(.regular.interactive(), in: Capsule())
        } else { searchContents(expandedWidth: expandedWidth).nativeGlassControl() }
        #else
        searchContents(expandedWidth: expandedWidth).nativeGlassControl()
        #endif
    }
    private func searchContents(expandedWidth: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            searchField.frame(width: expandedWidth, height: 46)
                .opacity(searching ? 1 : 0)
                .allowsHitTesting(searching)
                .accessibilityHidden(!searching)
            searchButton.opacity(searching ? 0 : 1)
                .allowsHitTesting(!searching)
                .accessibilityHidden(searching)
        }
        .frame(width: searching ? expandedWidth : 46, height: 46, alignment: .leading)
        .clipped()
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
                .disabled(!searching || !model.sessionsVisible || model.route != nil)
            Button { setSearching(false) } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .medium)).frame(width: 36, height: 44)
            }.buttonStyle(.plain).accessibilityLabel("Close search")
        }
        .padding(.leading, 16).padding(.trailing, 3).frame(height: 46)
    }
    private func setSearching(_ value: Bool) {
        if !value { dismissSearchFocus(); search = "" }
        searching = value
    }
    private func dismissSearchFocus() {
        guard searchFocused else { return }
        searchFocused = false
        searchFocusDismissal += 1
    }
    @ViewBuilder private var accountMenu: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            NativeProfileMenu(avatarURL: avatarURL, name: accountName, accessibilityLabel: model.isDemo ? "Test mode account" : "Account", signingOut: signingOut,
                              canAddAccount: !model.isDemo && !authorizingAccount, accounts: menuAccounts,
                              settings: { model.route = .settings }, addAccount: beginAddAccount,
                              switchAccount: { id in Task { await model.switchAccount(id) } }, signOut: signOut)
                .frame(width: 46, height: 46)
        } else { accountMenuControl.nativeGlassControl() }
        #else
        accountMenuControl.nativeGlassControl()
        #endif
    }
    private var accountMenuControl: some View {
        Menu {
            Button { model.route = .settings } label: { Label("Settings", systemImage: "gearshape") }
            Menu("Accounts", systemImage: "person.2") {
                Section("Accounts") {
                    ForEach(menuAccounts) { account in
                        Button { Task { await model.switchAccount(account.id) } } label: {
                            if account.active { Label(account.profile.displayName, systemImage: "checkmark") }
                            else { Text(account.profile.displayName) }
                        }
                    }
                }
                Section("Manage") {
                    Button(action: beginAddAccount) { Label("Add account", systemImage: "person.badge.plus") }
                        .disabled(model.isDemo || authorizingAccount)
                    Button(role: .destructive, action: signOut) {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }.disabled(signingOut)
                }
            }
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
    private var menuAccounts: [ZeronAccount] {
        if !model.zeronAccounts.isEmpty { return model.zeronAccounts }
        guard let profile = model.workspace.profile else { return [] }
        return [ZeronAccount(id: profile.id, profile: profile, organizationID: "", active: true)]
    }
    private func beginAddAccount() {
        guard !authorizingAccount, !model.isDemo else { return }
        authorizingAccount = true
        Task {
            defer { authorizingAccount = false }
            let state = UUID().uuidString
            do {
                let url = try model.authorizeURL(state: state)
                #if os(iOS)
                let callback: URL
                if #available(iOS 17.4, *) {
                    callback = try await authentication.authenticate(using: url, callback: .customScheme("zeron"),
                                                                     preferredBrowserSession: .shared, additionalHeaderFields: [:])
                } else {
                    callback = try await authentication.authenticate(using: url, callbackURLScheme: "zeron", preferredBrowserSession: .shared)
                }
                #else
                let callback = try await authentication.authenticate(using: url, callbackURLScheme: "zeron",
                                                                      preferredBrowserSession: .shared)
                #endif
                let code = try AuthenticationCallback.code(from: callback, expectedState: state)
                await model.signIn(code: code)
                choosingOrganization = model.organizations.count > 1
            } catch {
                if let cancelled = error as? ASWebAuthenticationSessionError, cancelled.code == .canceledLogin { return }
                model.error = (error as? ClientFailure)?.message ?? "The sign-in browser couldn't return to ZRemote. Please try again."
            }
        }
    }
    private var accountName: String { model.workspace.profile?.displayName ?? (model.isDemo ? "Test mode" : "") }
    private var avatarURL: URL? {
        guard !model.isDemo, let value = model.workspace.profile?.avatarURL, let url = URL(string: value),
              url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        return url
    }
    @ViewBuilder private var avatar: some View {
        if let url = avatarURL {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { initials }
        } else { initials }
    }
    private var initials: some View {
        let letters = accountName.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return Group {
            if letters.isEmpty { Image(systemName: "person.crop.circle").font(.system(size: 24)) }
            else { Text(letters.uppercased()).font(.subheadline.weight(.semibold)) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).foregroundStyle(Palette.text)
    }
    @ViewBuilder private var organizationMenu: some View {
        #if os(iOS)
        NativeGlassButton(image: UIImage(systemName: "slider.horizontal.3", withConfiguration: UIImage.SymbolConfiguration(pointSize: 19)),
                          menu: nativeOrganizationMenu, menuRevision: organizationMenuRevision,
                          accessibilityLabel: "Session display options", accessibilityValue: hasFilters ? "Filters active" : "",
                          enabled: true, size: 46)
            .frame(width: 46, height: 46)
        #else
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
                Button(action: resetFilters) { Label("Reset filters", systemImage: "arrow.counterclockwise") }.disabled(!hasFilters)
            } label: { Label("Filter", systemImage: "line.3.horizontal.decrease") }
            Menu {
                ForEach(SessionGrouping.allCases) { value in menuChoice(value.rawValue, selected: grouping == value) { grouping = value } }
            } label: { Label("Group", systemImage: "square.grid.2x2") }
            Divider()
            menuChoice("Compact view", selected: compact) { compact.toggle() }
        } label: {
            SessionFilterIcon()
                .font(.system(size: 19)).frame(width: 46, height: 46)
                .foregroundStyle(Palette.text)
                .nativeGlassControl()
        }.accessibilityLabel("Session display options").accessibilityValue(hasFilters ? "Filters active" : "")
        #endif
    }

    private func resetFilters() {
        shownProjectID = nil; status = .all; pullRequest = .all; archived = .active; created = .any; updated = .any; unreadOnly = false
    }

    #if os(iOS)
    /// Keep UIKit's presented menu tree intact across session activity, clock,
    /// search and refresh updates. Only visible menu content changes its revision.
    private var organizationMenuRevision: String {
        let projects = model.workspace.projects.map { [$0.id, $0.name] }
        let selections = [selectedProjectID ?? "", sort.rawValue, grouping.rawValue,
                          status.rawValue, pullRequest.rawValue, archived.rawValue,
                          created.rawValue, updated.rawValue, String(unreadOnly), String(compact)]
        return String(describing: projects) + String(describing: selections)
    }

    private var nativeOrganizationMenu: UIMenu {
        let show = UIMenu(title: "Show", image: UIImage(systemName: "folder"), identifier: .init("session-options.show"), children: [
            nativeMenuChoice("Show all", id: "show.all", selected: selectedProjectID == nil) { shownProjectID = nil },
            UIMenu(options: .displayInline, children: model.workspace.projects.map { project in
                nativeMenuChoice(project.name, id: "show.project.\(project.id)", selected: selectedProjectID == project.id) { shownProjectID = project.id }
            }),
        ])
        let filters = UIMenu(title: "Filter", image: UIImage(systemName: "line.3.horizontal.decrease"), identifier: .init("session-options.filter"), children: [
            nativeChoiceMenu("Status", symbol: "circle.dotted", id: "status", values: SessionStatusFilter.allCases, selection: $status),
            nativeChoiceMenu("Pull request", symbol: "arrow.triangle.branch", id: "pull-request", values: SessionPRFilter.allCases, selection: $pullRequest),
            nativeChoiceMenu("Archived", symbol: "archivebox", id: "archived", values: SessionArchiveFilter.allCases, selection: $archived),
            nativeChoiceMenu("Created date", symbol: "calendar", id: "created", values: SessionDateFilter.allCases, selection: $created),
            nativeChoiceMenu("Updated date", symbol: "calendar.badge.clock", id: "updated", values: SessionDateFilter.allCases, selection: $updated),
            nativeMenuChoice("Unread only", id: "unread", selected: unreadOnly) { unreadOnly.toggle() },
            UIMenu(options: .displayInline, children: [
                UIAction(title: "Reset filters", image: UIImage(systemName: "arrow.counterclockwise"), identifier: .init("session-options.reset"),
                         attributes: hasFilters ? [] : [.disabled]) { _ in
                    Task { @MainActor in resetFilters() }
                },
            ]),
        ])
        return UIMenu(identifier: .init("session-options"), children: [
            show,
            nativeChoiceMenu("Sort", symbol: "arrow.up.arrow.down", id: "sort", values: SessionSort.allCases, selection: $sort),
            filters,
            nativeChoiceMenu("Group", symbol: "square.grid.2x2", id: "group", values: SessionGrouping.allCases, selection: $grouping),
            UIMenu(options: .displayInline, children: [nativeMenuChoice("Compact view", id: "compact", selected: compact) { compact.toggle() }]),
        ])
    }

    private func nativeChoiceMenu<Value: RawRepresentable & Equatable>(_ title: String, symbol: String, id: String,
                                                                      values: [Value], selection: Binding<Value>) -> UIMenu where Value.RawValue == String {
        UIMenu(title: title, image: UIImage(systemName: symbol), identifier: .init("session-options.\(id)"), children: values.map { value in
            nativeMenuChoice(value.rawValue, id: "\(id).\(value.rawValue)", selected: selection.wrappedValue == value) { selection.wrappedValue = value }
        })
    }

    private func nativeMenuChoice(_ title: String, id: String, selected: Bool, action: @escaping @MainActor () -> Void) -> UIAction {
        UIAction(title: title, identifier: .init("session-options.\(id)"), state: selected ? .on : .off) { _ in
            Task { @MainActor in action() }
        }
    }
    #endif

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
                    Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                    Spacer(minLength: 0)
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
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    sessionIndicator(session).frame(width: 16).accessibilityHidden(true)
                    ProviderIcon(providerID: session.providerID, size: 14)
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
                        .padding(.leading, 46)
                }
            }.multilineTextAlignment(.leading)
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
            Button {
                renameContext = model.sessionDetailsContext(session.id)
                renameTitle = session.title
                renamingSession = session
            } label: { Label("Rename session", systemImage: "pencil") }
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
        if indicator == .working { ActivityGlyph(mini: true) }
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

struct SessionSection: Identifiable {
    var id: String
    var title: String
    var symbol: String
    var sessions: [Session]
    var showsHeader = true
    var collapsible = false
}
enum SessionSort: String, CaseIterable, Identifiable {
    case recent = "Recently updated", created = "Recently created", title = "Title"
    var id: String { rawValue }
}
enum SessionGrouping: String, CaseIterable, Identifiable {
    case project = "Project", host = "Host", status = "Status", none = "None"
    var id: String { rawValue }
}
enum SessionStatusFilter: String, CaseIterable, Identifiable {
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
enum SessionArchiveFilter: String, CaseIterable, Identifiable {
    case active = "Active", archived = "Archived", all = "All sessions"
    var id: String { rawValue }
    func includes(_ session: Session) -> Bool { self == .all || (self == .archived ? session.archived : !session.archived) }
}
enum SessionPRFilter: String, CaseIterable, Identifiable {
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
enum SessionDateFilter: String, CaseIterable, Identifiable {
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
