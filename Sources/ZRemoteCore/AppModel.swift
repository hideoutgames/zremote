import Foundation
import Observation
#if canImport(SkipFuse)
// Supplies the Compose-aware observation registrar in native Android builds.
// The dependency-free domain test target keeps the standard Observation registrar.
import SkipFuse
#endif

public enum SecondaryRoute: Identifiable {
    case models, projects, settings
    case changes(CapturedTurnChanges)
    case diff(DiffDocument)
    case pullRequest(PullRequest)
    public var id: String {
        switch self {
        case .models: return "models"
        case .projects: return "projects"
        case .settings: return "settings"
        case .changes(let turn): return "changes-" + turn.turnID
        case .diff(let document): return "diff-" + document.id
        case .pullRequest(let request): return "pull-request-" + request.id
        }
    }
}

@MainActor @Observable public final class AppModel {
    public var workspace = WorkspaceState()
    public var selectedSessionID: String?
    public var selectedHostID = ""
    public var selectedProjectID: String?
    public var newSelection = ModelSelection()
    public var catalog: [AgentModel] = []
    public var state: SessionState?
    public var sessionsVisible = false
    public var usesSessionPanel = false
    public var route: SecondaryRoute?
    public var busy = false
    public var restoring = true
    public var error: String?
    public var organizations: [Organization] = []
    public var isDemo = false
    public var preferences = LocalPreferences()
    public var agentAccounts = AgentAccountsSnapshot(available: false)
    public var loadingAccounts = false
    public var accountsError: String?
    public var notificationAuthorization = NotificationAuthorization.notDetermined
    public var notificationError: String?
    public var fetchingModels = false
    public var answering = false
    public var changesAfterMessage: [String: CapturedTurnChanges] = [:]
    public var pullRequestsAfterMessage: [String: [PullRequest]] = [:]
    private var attachmentDrafts: [String: [LocalAttachment]] = [:]

    @ObservationIgnored private let notifications: any NotificationService
    @ObservationIgnored private var notificationTask: Task<Void, Never>?
    @ObservationIgnored private var accountsTask: Task<Void, Never>?
    @ObservationIgnored private var editedNotifications = false
    @ObservationIgnored private var accountsRequest = 0
    @ObservationIgnored private var accountHostID: String?
    @ObservationIgnored private var accountSnapshotsByHost: [String: AgentAccountsSnapshot] = [:]
    @ObservationIgnored private var foreground = true
    @ObservationIgnored private var pendingNotificationSession: String?
    @ObservationIgnored private var notificationDeliveries: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var notificationDeliveryEvents: [String: SessionNotification] = [:]
    @ObservationIgnored private var queuedNotifications: [String: SessionNotification] = [:]
    @ObservationIgnored private var observedRunningSessions: Set<String> = []
    @ObservationIgnored private var client: any ClientService
    @ObservationIgnored private let makeLiveClient: @MainActor () -> any ClientService
    @ObservationIgnored private let makeStore: (String) -> LocalStateStore
    @ObservationIgnored private var store: LocalStateStore?
    @ObservationIgnored private var restoredAccount: String?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var selectionGeneration = 0
    @ObservationIgnored private var modelRequest = 0
    @ObservationIgnored private var sessions: [String: SessionState] = [:]
    @ObservationIgnored private var capturing: Set<String> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var modelTask: Task<Void, Never>?
    @ObservationIgnored private var loadingPreferences = false
    @ObservationIgnored private var saveAfterRestore = false
    @ObservationIgnored private var editedDrafts: Set<String> = []
    @ObservationIgnored private var editedFavorites = false
    @ObservationIgnored private var editedBackground = false
    @ObservationIgnored private var changeSizes: [String: Int] = [:]

    public init(client: any ClientService, makeLiveClient: @escaping @MainActor () -> any ClientService,
                makeStore: @escaping (String) -> LocalStateStore = { LocalStateStore(accountKey: $0) },
                notifications: any NotificationService = UnavailableNotifications()) {
        self.client = client
        self.isDemo = client.isDemo
        self.makeLiveClient = makeLiveClient
        self.makeStore = makeStore
        self.notifications = notifications
        notificationAuthorization = notifications.supported ? .notDetermined : .unavailable
        notifications.onSession = { [weak self] id in
            guard let self, !self.isDemo else { return }
            self.pendingNotificationSession = id
            self.openPendingNotification()
        }
        bindClient()
    }

    public var signedIn: Bool { workspace.connection != .signedOut && workspace.connection != .expired }
    public var session: Session? { workspace.sessions.first { $0.id == selectedSessionID } }
    public var project: Project? { workspace.projects.first { $0.id == (session?.projectID ?? selectedProjectID) } }
    public var selection: ModelSelection { state?.selection ?? newSelection }
    public var selectedModel: AgentModel? { catalog.first { $0.providerID == selection.providerID && $0.modelID == selection.modelID } }
    public var modelName: String { selectedModel?.name ?? selection.modelID ?? "Choose model" }
    public var working: Bool { state?.working ?? false }
    public var notificationsSupported: Bool { notifications.supported && !isDemo }
    public var usageWarning: UsageWarning? {
        guard let id = selectedSessionID, !preferences.dismissedUsageSessions.contains(id),
              agentAccounts.available, accountHostID == (session?.hostID ?? selectedHostID) else { return nil }
        return UsageLimitRules.warning(remaining: UsageLimitRules.remaining(accounts: agentAccounts.accounts, selection: selection))
    }
    public var changes: [CapturedTurnChanges] { preferences.changes.filter { $0.sessionID == selectedSessionID } }
    public var attachments: [LocalAttachment] { attachmentDrafts[selectedSessionID ?? "new"] ?? [] }
    public var attachmentContext: String { "\(generation):\(selectedSessionID ?? "new"):\(session?.hostID ?? selectedHostID):\(session?.projectID ?? selectedProjectID ?? "")" }
    public var transcriptText: String { (state?.messages ?? []).map { "\($0.role.capitalized):\n\($0.text)" }.joined(separator: "\n\n") }
    public var sessionPullRequests: [PullRequest] { preferences.pullRequests.filter { $0.sessionID == selectedSessionID }.map(\.request) }
    public var unanchoredPullRequests: [PullRequest] {
        let visible = Set(state?.messages.map(\.id) ?? [])
        return preferences.pullRequests.filter { $0.sessionID == selectedSessionID && ($0.afterMessageID == nil || !visible.contains($0.afterMessageID!)) }.map(\.request)
    }
    public var draft: String {
        get { preferences.drafts[selectedSessionID ?? "new"] ?? "" }
        set { setDraft(newValue, for: selectedSessionID ?? "new"); scheduleSave() }
    }
    public var canSend: Bool {
        signedIn && !busy && !working && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
            && !(session?.hostID ?? selectedHostID).isEmpty
            && (selectedSessionID != nil || newSelection.modelID != nil)
    }

    public func start() async {
        let epoch = generation
        defer { if epoch == generation { restoring = false } }
        do { try await client.restore() } catch { if epoch == generation { self.error = "Couldn't restore your session. Please sign in again." } }
    }

    public func enterDemo() async {
        await disconnect()
        client = DemoClient()
        isDemo = true
        bindClient()
        await start()
    }

    public func disconnect() async {
        generation += 1
        restoring = true
        defer { restoring = false }
        let oldClient = client
        let oldStore = store
        oldClient.onUpdate = nil
        resetAccountState()
        do { try await oldClient.signOut() } catch { self.error = "Couldn't fully clear sign-in. Try again." }
        if let oldStore { try? await oldStore.clear() }
        client = makeLiveClient()
        bindClient()
    }

    private func resetAccountState() {
        saveTask?.cancel(); modelTask?.cancel(); notificationTask?.cancel(); accountsTask?.cancel()
        for task in notificationDeliveries.values { task.cancel() }
        notificationDeliveries = [:]; notificationDeliveryEvents = [:]; queuedNotifications = [:]; observedRunningSessions = []
        notifications.stop(); accountsRequest += 1; accountHostID = nil; accountSnapshotsByHost = [:]; pendingNotificationSession = nil
        agentAccounts = AgentAccountsSnapshot(available: false); loadingAccounts = false; accountsError = nil
        notificationAuthorization = notifications.supported ? .notDetermined : .unavailable; notificationError = nil
        modelRequest += 1; selectionGeneration += 1
        store = nil; restoredAccount = nil; capturing = []
        loadingPreferences = false; saveAfterRestore = false
        editedDrafts = []; editedFavorites = false; editedBackground = false; editedNotifications = false
        changeSizes = [:]
        workspace = WorkspaceState(); sessions = [:]; state = nil
        selectedSessionID = nil; selectedProjectID = nil; selectedHostID = ""
        preferences = LocalPreferences(); catalog = []; route = nil; organizations = []; changesAfterMessage = [:]
        attachmentDrafts = [:]; pullRequestsAfterMessage = [:]
        newSelection = ModelSelection()
        sessionsVisible = false; isDemo = false; busy = false; answering = false; fetchingModels = false
    }

    private func bindClient() {
        client.onUpdate = { [weak self] update in self?.receive(update) }
    }

    private func receive(_ update: ClientUpdate) {
        switch update {
        case .workspace(let next):
            if let old = restoredAccount, let nextKey = client.accountKey, old != nextKey {
                generation += 1
                resetAccountState()
            }
            let previousWorkspace = workspace
            workspace = next
            var finishedChanged = false
            for index in workspace.sessions.indices {
                let row = workspace.sessions[index]
                if let finished = row.lastFinishedAt {
                    if preferences.sessionFinishedAt[row.id] != finished { preferences.sessionFinishedAt[row.id] = finished; finishedChanged = true }
                } else { workspace.sessions[index].lastFinishedAt = preferences.sessionFinishedAt[row.id] }
            }
            if finishedChanged { scheduleSave() }
            observeSessionNotifications(previous: previousWorkspace, next: next)
            observePullRequests()
            if selectedHostID.isEmpty { selectedHostID = next.hosts.first(where: { $0.online })?.id ?? next.hosts.first?.id ?? "" }
            if catalog.isEmpty && !fetchingModels { loadModels() }
            restorePreferencesIfNeeded()
            let oldActiveHosts = Set(previousWorkspace.sessions.filter(\.working).map(\.hostID))
            let activeHosts = Set(next.sessions.filter(\.working).map(\.hostID))
            if oldActiveHosts != activeHosts { restartUsageMonitoring() }
            openPendingNotification()
        case .session(let next):
            let previous = sessions[next.id]
            sessions[next.id] = next
            if selectedSessionID == next.id {
                state = next
                observePullRequests()
                if previous?.messages.count != next.messages.count || previous?.working != next.working { placeChangeCards() }
            }
            // A turn can finish while its session is closed or the app is suspended.
            // Reopening also attempts the latest completed snapshot while it exists.
            if !next.working && next.input == nil { captureChanges(next) }
            if previous?.working != next.working { restartUsageMonitoring() }
            trimSessionCache()
        case .authenticationExpired:
            generation += 1
            resetAccountState()
            workspace = WorkspaceState(connection: .expired)
            error = "Your sign-in expired. Sign in again to reconnect."
        }
    }

    public func newSession() {
        selectionGeneration += 1
        if let id = selectedSessionID { client.closeSession(id) }
        selectedSessionID = nil; state = nil; changesAfterMessage = [:]; pullRequestsAfterMessage = [:]
        if !usesSessionPanel { sessionsVisible = false }
        loadModels()
    }

    public func open(_ id: String) async {
        selectionGeneration += 1
        let epoch = generation
        let selectionEpoch = selectionGeneration
        if let old = selectedSessionID, old != id { client.closeSession(old) }
        selectedSessionID = id; state = sessions[id]
        if !usesSessionPanel { sessionsVisible = false }
        placeChangeCards()
        placePullRequestCards()
        do {
            try await client.openSession(id)
            guard epoch == generation, selectionEpoch == selectionGeneration else { return }
            loadModels()
        } catch {
            if epoch == generation, selectionEpoch == selectionGeneration { self.error = "Couldn't open this session. Try again when the host is online." }
        }
    }

    public func send() async {
        guard canSend else { return }
        busy = true
        let epoch = generation
        let selectionEpoch = selectionGeneration
        let source = client
        defer { if epoch == generation { busy = false } }
        let text = draft
        let submittedAttachments = attachments
        let oldDraftKey = selectedSessionID ?? "new"
        do {
            let id: String
            if let selectedSessionID { id = selectedSessionID }
            else {
                id = try await source.createSession(projectID: selectedProjectID, hostID: selectedHostID, selection: newSelection)
                guard epoch == generation else { return }
                // Transfer the editable draft before any later operation can fail.
                // Navigation during creation must not redirect the user back here.
                if selectionEpoch == selectionGeneration {
                    setDraft(preferences.drafts[oldDraftKey] ?? text, for: id)
                    setDraft(nil, for: oldDraftKey)
                    attachmentDrafts[id] = attachmentDrafts.removeValue(forKey: oldDraftKey)
                    selectedSessionID = id
                    state = sessions[id]
                    placeChangeCards()
                } else {
                    setDraft(text, for: id)
                    attachmentDrafts[id] = submittedAttachments
                    removeSubmittedAttachments(submittedAttachments, from: oldDraftKey)
                    if preferences.drafts[oldDraftKey] == text { setDraft(nil, for: oldDraftKey) }
                }
                scheduleSave()
                try await source.openSession(id)
            }
            guard epoch == generation else { return }
            try await source.send(sessionID: id, text: text, attachments: submittedAttachments)
            guard epoch == generation else { return }
            // Clear only the exact draft submitted; a later edit must survive.
            if preferences.drafts[id] == text { setDraft(nil, for: id) }
            removeSubmittedAttachments(submittedAttachments, from: id)
            scheduleSave()
        } catch { if epoch == generation { self.error = "Message wasn't sent. Your draft is still saved." } }
    }

    public func addAttachment(_ attachment: LocalAttachment, context: String? = nil) throws {
        guard context == nil || context == attachmentContext else { throw ClientFailure("The composer changed while the picker was open. Add the attachment again.") }
        try attachment.validate()
        guard attachments.reduce(attachment.data.count, { $0 + $1.data.count }) <= LocalAttachment.maximumDraftBytes else { throw ClientFailure("Keep the attachments in one message under 48 MB.") }
        let pendingBytes = attachmentDrafts.values.reduce(attachment.data.count) { $0 + $1.reduce(0) { $0 + $1.data.count } }
        guard pendingBytes <= LocalAttachment.maximumPendingBytes else { throw ClientFailure("Send or remove pending attachments in another session before adding more.") }
        attachmentDrafts[selectedSessionID ?? "new", default: []].append(attachment)
    }
    public func removeAttachment(_ id: String) { attachmentDrafts[selectedSessionID ?? "new"]?.removeAll { $0.id == id } }
    private func removeSubmittedAttachments(_ submitted: [LocalAttachment], from key: String) {
        let ids = Set(submitted.map(\.id))
        attachmentDrafts[key]?.removeAll { ids.contains($0.id) }
    }
    public func attachmentData(sessionID: String, attachment: RemoteAttachment) async throws -> Data {
        let epoch = generation
        let data = try await client.readAttachment(sessionID: sessionID, attachment: attachment)
        guard epoch == generation else { throw CancellationError() }
        return data
    }
    public func complete(kind: ComposerTokenKind, query: String) async -> [ComposerCompletion] {
        let epoch = generation, selected = selectionGeneration
        let host = session?.hostID ?? selectedHostID
        let provider = selection.providerID
        let project = session?.projectID ?? selectedProjectID
        guard !host.isEmpty else { return [] }
        do {
            let result = try await client.complete(kind: kind, query: query, hostID: host,
                sessionID: selectedSessionID, projectID: project, providerID: provider)
            guard !Task.isCancelled, epoch == generation, selected == selectionGeneration,
                  host == (session?.hostID ?? selectedHostID), provider == selection.providerID,
                  project == (session?.projectID ?? selectedProjectID) else { return [] }
            return result
        } catch { return [] }
    }
    public func setPinned(_ session: Session, pinned: Bool) async {
        let epoch = generation
        do { try await client.setPinned(sessionID: session.id, pinned: pinned) }
        catch { if epoch == generation { self.error = "Couldn't update the pinned session." } }
    }
    public func togglePin(_ session: Session) async { await setPinned(session, pinned: !session.pinned) }
    public func archive(_ session: Session) async { await setArchived(session, archived: true) }
    public func unarchive(_ session: Session) async { await setArchived(session, archived: false) }
    private func setArchived(_ session: Session, archived: Bool) async {
        let epoch = generation
        do { try await client.setArchived(sessionID: session.id, archived: archived) }
        catch { if epoch == generation { self.error = "Couldn't update this session's archive status." } }
    }

    public func stop() async {
        guard let id = selectedSessionID else { return }
        let epoch = generation
        do { try await client.interrupt(sessionID: id) }
        catch { if epoch == generation { self.error = "Couldn't stop the agent. Try again when the host reconnects." } }
    }

    public func retryDelivery() async {
        guard let id = selectedSessionID, state?.deliveryFailed == true, !busy else { return }
        let epoch = generation
        busy = true
        defer { if epoch == generation { busy = false } }
        do { try await client.retryDelivery(sessionID: id) }
        catch { if epoch == generation { self.error = "Couldn't retry delivery. Your queued message is still saved." } }
    }

    public func loadModels() {
        let host = session?.hostID ?? selectedHostID
        guard !host.isEmpty else { return }
        modelTask?.cancel()
        modelRequest += 1
        let request = modelRequest
        fetchingModels = true
        let currentGeneration = generation
        let source = client
        restartUsageMonitoring()
        modelTask = Task { [weak self] in
            guard let self, !Task.isCancelled, currentGeneration == self.generation else { return }
            defer { if currentGeneration == self.generation, request == self.modelRequest { self.fetchingModels = false } }
            do {
                let values = try await source.models(hostID: host)
                guard !Task.isCancelled, currentGeneration == self.generation, (self.session?.hostID ?? self.selectedHostID) == host else { return }
                self.catalog = values
                if self.selectedSessionID == nil {
                    let current = values.first { $0.providerID == self.newSelection.providerID && $0.modelID == self.newSelection.modelID }
                    if let selected = current ?? values.first {
                        self.newSelection = ModelCatalogRules.selecting(selected, previous: self.newSelection)
                    } else { self.newSelection = ModelSelection() }
                }
            } catch {
                if !Task.isCancelled, currentGeneration == self.generation, request == self.modelRequest { self.error = "Models aren't available from this host yet." }
            }
        }
    }

    public func chooseModel(_ value: ModelSelection) async {
        let epoch = generation
        if let id = selectedSessionID {
            guard value.providerID == state?.selection.providerID else { return }
            do { try await client.setModel(sessionID: id, selection: value) }
            catch { if epoch == generation { self.error = "Couldn't change this session's model." } }
        } else { newSelection = value }
    }
    public func toggleFavorite(_ id: String) {
        editedFavorites = true
        if preferences.favorites.contains(id) { preferences.favorites.remove(id) }
        else { preferences.favorites.insert(id) }
        scheduleSave()
    }
    public func setBackgroundImage(data: Data?, name: String?) {
        guard (data?.count ?? 0) <= 2_000_000 else { error = "Choose a background image smaller than 2 MB."; return }
        editedBackground = true
        preferences.backgroundImageData = data
        preferences.backgroundImageName = data == nil ? nil : name
        if data != nil { preferences.backgroundEnabled = true }
        scheduleSave()
    }
    public func setBackgroundEffect(_ effect: String) {
        guard ["none", "dither", "ascii", "halftone", "scanlines"].contains(effect) else { return }
        editedBackground = true; preferences.backgroundEffect = effect; scheduleSave()
    }
    public func dismissUsageWarning() {
        guard let id = selectedSessionID else { return }
        preferences.dismissedUsageSessions.insert(id); scheduleSave()
    }
    public func setNotifications(_ value: NotificationPreferences) {
        editedNotifications = true; preferences.notifications = value; scheduleSave()
        for (id, event) in notificationDeliveryEvents where !notificationEnabled(event.kind) {
            notificationDeliveries[id]?.cancel()
        }
        queuedNotifications = queuedNotifications.filter { notificationEnabled($0.value.kind) }
        syncNotifications(requestPermission: value.enabled)
    }
    public func syncNotifications(requestPermission: Bool = false) {
        guard signedIn, !isDemo, notifications.supported, !loadingPreferences else { return }
        notificationTask?.cancel()
        let epoch = generation, prefs = preferences.notifications
        notificationTask = Task { [weak self] in
            guard let self else { return }
            let authorization = await self.notifications.authorization(request: requestPermission && prefs.enabled)
            guard epoch == self.generation, !Task.isCancelled else { return }
            self.notificationAuthorization = authorization
            if !prefs.enabled {
                for task in self.notificationDeliveries.values { task.cancel() }
                self.notificationDeliveries = [:]; self.notificationDeliveryEvents = [:]; self.queuedNotifications = [:]
                self.notifications.stop()
            } else if authorization == .authorized {
                self.flushNotifications()
            }
        }
    }

    private func observeSessionNotifications(previous: WorkspaceState, next: WorkspaceState) {
        let previousRows = Dictionary(uniqueKeysWithValues: previous.sessions.map { ($0.id, $0) })
        for row in next.sessions {
            defer {
                if row.working { observedRunningSessions.insert(row.id) }
                else if row.failed { observedRunningSessions.remove(row.id) }
            }
            guard previous.connection == .online, next.connection == .online,
                  let old = previousRows[row.id] else { continue }
            if row.awaitingInput,
               !old.awaitingInput || (old.inputRequestID != nil && row.inputRequestID != nil && old.inputRequestID != row.inputRequestID && !old.inputRequestID!.hasPrefix("pending:")),
               let request = row.inputRequestID {
                queueNotification(SessionNotification(id: "question:" + row.id + ":" + request, sessionID: row.id, kind: .question))
            }
            if let turn = row.completedTurnID, turn != old.completedTurnID, observedRunningSessions.contains(row.id) {
                queueNotification(SessionNotification(id: "finished:" + row.id + ":" + turn, sessionID: row.id, kind: .finished))
                if !row.working && !row.awaitingInput { observedRunningSessions.remove(row.id) }
            }
        }
    }

    private func notificationEnabled(_ kind: SessionNotificationKind) -> Bool {
        let prefs = preferences.notifications
        guard prefs.enabled else { return false }
        switch kind {
        case .question: return prefs.questions
        case .finished: return prefs.finished
        case .usageLimit: return prefs.usageLimits
        }
    }

    private func queueNotification(_ event: SessionNotification) {
        guard !isDemo, notifications.supported, !preferences.notificationEvents.contains(event.id),
              notificationDeliveries[event.id] == nil,
              loadingPreferences || notificationEnabled(event.kind) else { return }
        queuedNotifications[event.id] = event
        flushNotifications()
    }

    private func flushNotifications() {
        guard !loadingPreferences, !isDemo, signedIn, notifications.supported else { return }
        for event in Array(queuedNotifications.values) {
            guard notificationEnabled(event.kind), !preferences.notificationEvents.contains(event.id),
                  notificationDeliveries[event.id] == nil else { queuedNotifications[event.id] = nil; continue }
            if event.kind == .usageLimit, preferences.usageNotifiedSessions.contains(event.sessionID) { queuedNotifications[event.id] = nil; continue }
            let epoch = generation
            queuedNotifications[event.id] = nil
            notificationDeliveryEvents[event.id] = event
            notificationDeliveries[event.id] = Task { [weak self] in
                guard let self else { return }
                defer { if epoch == self.generation { self.notificationDeliveries[event.id] = nil; self.notificationDeliveryEvents[event.id] = nil } }
                let authorization = await self.notifications.authorization(request: false)
                guard epoch == self.generation, !Task.isCancelled, self.notificationEnabled(event.kind), authorization == .authorized else { return }
                do {
                    try await self.notifications.deliver(event)
                    guard epoch == self.generation, !Task.isCancelled else { return }
                    self.preferences.notificationEvents.insert(event.id)
                    if event.kind == .usageLimit { self.preferences.usageNotifiedSessions.insert(event.sessionID) }
                    self.notificationError = nil
                    self.scheduleSave()
                } catch {
                    if epoch == self.generation, !Task.isCancelled {
                        self.queuedNotifications[event.id] = event
                        self.notificationError = "A notification couldn't be delivered. Check notification permissions."
                    }
                }
            }
        }
    }

    private func observeUsageThreshold(previous: AgentAccountsSnapshot, next: AgentAccountsSnapshot, hostID: String) {
        guard previous.available, next.available else { return }
        for row in workspace.sessions where row.hostID == hostID && row.working {
            let selection = row.providerID.isEmpty ? (sessions[row.id]?.selection ?? ModelSelection()) : ModelSelection(providerID: row.providerID, modelID: row.modelID)
            let old = UsageLimitRules.remaining(accounts: previous.accounts, selection: selection)
            let remaining = UsageLimitRules.remaining(accounts: next.accounts, selection: selection)
            if UsageLimitRules.crossedThreshold(previous: old, remaining: remaining, working: true,
                                               alreadyNotified: preferences.usageNotifiedSessions.contains(row.id)) {
                queueNotification(SessionNotification(id: "usage:" + row.id, sessionID: row.id, kind: .usageLimit))
            }
        }
    }

    public func fetchAgentAccounts(hostID: String) async throws -> AgentAccountsSnapshot {
        let epoch = generation
        let snapshot = try await client.agentAccounts(hostID: hostID)
        guard epoch == generation else { throw CancellationError() }
        return snapshot
    }
    public func refreshAgentAccounts() async {
        let host = session?.hostID ?? selectedHostID
        guard !host.isEmpty else { agentAccounts = AgentAccountsSnapshot(available: false); return }
        accountsRequest += 1
        let request = accountsRequest, epoch = generation
        if accountHostID != host { agentAccounts = AgentAccountsSnapshot(available: false); accountHostID = host }
        loadingAccounts = true
        defer { if epoch == generation, request == accountsRequest { loadingAccounts = false } }
        do {
            let snapshot = try await client.agentAccounts(hostID: host)
            guard epoch == generation, request == accountsRequest, host == (session?.hostID ?? selectedHostID) else { return }
            observeUsageThreshold(previous: accountSnapshotsByHost[host] ?? agentAccounts, next: snapshot, hostID: host)
            accountSnapshotsByHost[host] = snapshot
            agentAccounts = snapshot; accountsError = nil
        } catch {
            if epoch == generation, request == accountsRequest { accountsError = "Usage is unavailable from this host right now." }
        }
    }
    public func setBackground(_ enabled: Bool) { editedBackground = true; preferences.backgroundEnabled = enabled; scheduleSave() }
    public func setHost(_ id: String) { updateHost(id); selectedProjectID = nil; loadModels() }
    public func selectProject(_ project: Project) { updateHost(project.hostID); selectedProjectID = project.id; loadModels(); route = nil }
    public func folders(hostID: String, path: String?) async throws -> FolderPage { try await client.listFolders(hostID: hostID, path: path) }
    public func addProject(hostID: String, folder: RemoteFolder) async throws {
        let epoch = generation
        let id = try await client.addProject(hostID: hostID, path: folder.path, isRepository: folder.isRepository)
        guard epoch == generation else { throw CancellationError() }
        updateHost(hostID); selectedProjectID = id; loadModels(); route = nil
    }
    public func createProject(hostID: String, name: String) async throws {
        let epoch = generation
        let id = try await client.createRepository(hostID: hostID, name: name)
        guard epoch == generation else { throw CancellationError() }
        updateHost(hostID); selectedProjectID = id; loadModels(); route = nil
    }
    public func authorizeURL(state: String) throws -> URL { try client.authorizationURL(state: state) }
    public func signIn(code: String) async {
        let epoch = generation
        busy = true
        defer { if epoch == generation { busy = false } }
        do {
            let values = try await client.exchangeCode(code)
            guard epoch == generation else { return }
            organizations = values
            if organizations.count == 1 { await chooseOrganization(organizations[0].id) }
        } catch { if epoch == generation { self.error = "Sign-in didn't finish. Please try again." } }
    }
    public func chooseOrganization(_ id: String) async {
        let epoch = generation
        do { try await client.selectOrganization(id); if epoch == generation { organizations = [] } }
        catch { if epoch == generation { self.error = "Couldn't open this organization." } }
    }
    public func answer(requestID: String, answers: [String: [String]]) async {
        guard let id = selectedSessionID, state?.input?.id == requestID, !answering else { return }
        let epoch = generation
        answering = true
        defer { if epoch == generation { answering = false } }
        do { try await client.respondInput(sessionID: id, requestID: requestID, answers: answers) }
        catch { if epoch == generation { self.error = "Couldn't send your answer. Please try again." } }
    }
    public func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        client.setForeground(foreground)
        if foreground { syncNotifications(); restartUsageMonitoring() }
        else { accountsTask?.cancel() }
    }

    private func restartUsageMonitoring() {
        accountsTask?.cancel()
        guard foreground, signedIn else { return }
        let epoch = generation
        accountsTask = Task { [weak self] in
            while let self, epoch == self.generation, !Task.isCancelled {
                await self.refreshAgentAccounts()
                guard !Task.isCancelled else { return }
                let host = self.session?.hostID ?? self.selectedHostID
                let otherHosts = Set(self.workspace.sessions.filter { $0.working && $0.hostID != host }.map(\.hostID))
                for otherHost in otherHosts.sorted() {
                    guard !Task.isCancelled, epoch == self.generation else { return }
                    if let snapshot = try? await self.client.agentAccounts(hostID: otherHost) {
                        guard !Task.isCancelled, epoch == self.generation else { return }
                        self.observeUsageThreshold(previous: self.accountSnapshotsByHost[otherHost] ?? .init(available: false), next: snapshot, hostID: otherHost)
                        self.accountSnapshotsByHost[otherHost] = snapshot
                    }
                }
                guard self.foreground, self.workspace.sessions.contains(where: \.working) else { return }
                do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
            }
        }
    }

    private func openPendingNotification() {
        guard signedIn, !isDemo, let id = pendingNotificationSession,
              workspace.sessions.contains(where: { $0.id == id }) else { return }
        pendingNotificationSession = nil
        let epoch = generation
        Task {
            guard epoch == generation, signedIn, !isDemo else { return }
            route = nil
            await open(id)
        }
    }

    private func captureChanges(_ session: SessionState) {
        guard let turn = session.turnID else { return }
        let key = session.id + ":" + turn
        guard !capturing.contains(key), !preferences.changes.contains(where: { $0.sessionID == session.id && $0.turnID == turn }) else { return }
        capturing.insert(key)
        let currentGeneration = generation
        let source = client
        Task { [weak self] in
            guard let self, currentGeneration == self.generation else { return }
            defer {
                if currentGeneration == self.generation {
                    self.capturing.remove(key)
                    self.trimSessionCache()
                }
            }
            do {
                let diff = try await source.turnDiff(sessionID: session.id, turnID: turn)
                guard currentGeneration == self.generation, self.sessions[session.id]?.turnID == turn,
                      self.sessions[session.id]?.working == false else { return }
                let captured = try await CapturedTurnChanges.capture(sessionID: session.id, turnID: turn, patch: diff.patch, isTruncated: diff.partial)
                let known = Set(captured.files.map(\.path))
                let missing = diff.paths.filter { !known.contains($0) }.map {
                    CapturedFileChange(id: UUID().uuidString, path: $0, patch: nil, isPartial: true)
                }
                let snapshot = CapturedTurnChanges(sessionID: session.id, turnID: turn, files: captured.files + missing, capturedAt: captured.capturedAt)
                let sizes = await Self.measureChanges([snapshot])
                guard currentGeneration == self.generation, self.sessions[session.id]?.turnID == turn,
                      self.sessions[session.id]?.working == false, !snapshot.files.isEmpty else { return }
                self.preferences.changes.append(snapshot)
                self.changeSizes.merge(sizes) { _, next in next }
                self.trimChanges()
                self.placeChangeCards()
                self.scheduleSave()
            } catch { /* Older hosts and expired turn snapshots have no completion card. */ }
        }
    }

    private func placeChangeCards() {
        changesAfterMessage = [:]
        guard let state else { return }
        let turns = changes
        for turn in turns {
            guard let start = state.messages.firstIndex(where: { $0.id == turn.turnID }) else { continue }
            let nextUser = state.messages.indices.first { $0 > start && state.messages[$0].role == "user" } ?? state.messages.endIndex
            let end = max(start, nextUser - 1)
            changesAfterMessage[state.messages[end].id] = turn
        }
    }

    private func observePullRequests() {
        var changed = false
        for session in workspace.sessions {
            guard let request = session.pullRequest else { continue }
            let anchor = session.id == selectedSessionID ? state?.messages.last?.id : nil
            if let index = preferences.pullRequests.firstIndex(where: { $0.sessionID == session.id && $0.request.id == request.id }) {
                if preferences.pullRequests[index].request != request { preferences.pullRequests[index].request = request; changed = true }
                if preferences.pullRequests[index].afterMessageID == nil, let anchor {
                    preferences.pullRequests[index].afterMessageID = anchor; changed = true
                }
            } else {
                preferences.pullRequests.append(ObservedPullRequest(sessionID: session.id, afterMessageID: anchor, request: request)); changed = true
            }
        }
        if preferences.pullRequests.count > 256 { preferences.pullRequests.removeFirst(preferences.pullRequests.count - 256) }
        placePullRequestCards()
        if changed { scheduleSave() }
    }
    private func placePullRequestCards() {
        pullRequestsAfterMessage = [:]
        for value in preferences.pullRequests where value.sessionID == selectedSessionID {
            if let anchor = value.afterMessageID { pullRequestsAfterMessage[anchor, default: []].append(value.request) }
        }
    }

    private func trimSessionCache() {
        // Reopening asks the peer for a fresh projection. Keep the current view
        // and pending diff captures, without retaining every transcript visited.
        for id in Array(sessions.keys) where sessions.count > 3 && id != selectedSessionID {
            if !capturing.contains(where: { $0.hasPrefix(id + ":") }) { sessions[id] = nil }
        }
    }

    private func trimChanges() {
        var bytes = preferences.changes.reduce(0) { $0 + (changeSizes[$1.sessionID + ":" + $1.turnID] ?? 0) }
        while (preferences.changes.count > 16 || bytes > 16_000_000), !preferences.changes.isEmpty {
            let removed = preferences.changes.removeFirst()
            bytes -= changeSizes.removeValue(forKey: removed.sessionID + ":" + removed.turnID) ?? 0
        }
    }

    // Encoding a large completed patch must not block streaming or scrolling.
    private nonisolated static func measureChanges(_ changes: [CapturedTurnChanges]) async -> [String: Int] {
        await Task.detached(priority: .utility) {
            changes.reduce(into: [String: Int]()) { result, turn in
                result[turn.sessionID + ":" + turn.turnID] = (try? JSONEncoder().encode(turn).count) ?? 16_000_001
            }
        }.value
    }
    private func restorePreferencesIfNeeded() {
        guard !isDemo, let key = client.accountKey, key != restoredAccount else { return }
        restoredAccount = key
        let newStore = makeStore(key)
        store = newStore
        loadingPreferences = true
        let currentGeneration = generation
        Task { [weak self] in
            do {
                let restored = try await newStore.load()
                let sizes = await Self.measureChanges(restored.changes)
                guard let self, self.generation == currentGeneration, self.restoredAccount == key else { return }
                // Preserve edits, including draft deletion, made during the disk read.
                var merged = restored
                for id in self.editedDrafts { merged.drafts[id] = self.preferences.drafts[id] }
                if self.editedFavorites { merged.favorites = self.preferences.favorites }
                if self.editedBackground {
                    merged.backgroundEnabled = self.preferences.backgroundEnabled
                    merged.backgroundImageData = self.preferences.backgroundImageData
                    merged.backgroundImageName = self.preferences.backgroundImageName
                    merged.backgroundEffect = self.preferences.backgroundEffect
                }
                if self.editedNotifications { merged.notifications = self.preferences.notifications }
                merged.dismissedUsageSessions.formUnion(self.preferences.dismissedUsageSessions)
                merged.usageNotifiedSessions.formUnion(self.preferences.usageNotifiedSessions)
                merged.notificationEvents.formUnion(self.preferences.notificationEvents)
                merged.sessionFinishedAt.merge(self.preferences.sessionFinishedAt) { old, current in max(old, current) }
                for turn in self.preferences.changes where !merged.changes.contains(where: { $0.sessionID == turn.sessionID && $0.turnID == turn.turnID }) {
                    merged.changes.append(turn)
                }
                for observed in self.preferences.pullRequests {
                    if let index = merged.pullRequests.firstIndex(where: { $0.sessionID == observed.sessionID && $0.request.id == observed.request.id }) {
                        merged.pullRequests[index].request = observed.request
                        if merged.pullRequests[index].afterMessageID == nil { merged.pullRequests[index].afterMessageID = observed.afterMessageID }
                    } else { merged.pullRequests.append(observed) }
                }
                if !self.preferences.pullRequests.isEmpty || !self.preferences.sessionFinishedAt.isEmpty { self.saveAfterRestore = true }
                self.preferences = merged
                for index in self.workspace.sessions.indices where self.workspace.sessions[index].lastFinishedAt == nil {
                    self.workspace.sessions[index].lastFinishedAt = merged.sessionFinishedAt[self.workspace.sessions[index].id]
                }
                self.changeSizes.merge(sizes) { current, _ in current }
                self.loadingPreferences = false
                self.syncNotifications()
                self.trimChanges()
                self.placeChangeCards()
                self.placePullRequestCards()
                if self.saveAfterRestore { self.saveAfterRestore = false; self.scheduleSave() }
            } catch {
                if let self, self.generation == currentGeneration, self.restoredAccount == key {
                    self.loadingPreferences = false
                    self.error = "Couldn't restore local drafts. Remote sessions are unaffected."
                    if self.saveAfterRestore { self.saveAfterRestore = false; self.scheduleSave() }
                }
            }
        }
    }
    private func scheduleSave() {
        guard let store, !isDemo else { return }
        if loadingPreferences { saveAfterRestore = true; return }
        saveTask?.cancel()
        let value = preferences
        let epoch = generation
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            do { try await store.save(value) }
            catch { if let self, self.generation == epoch { self.error = "Couldn't save local changes on this device." } }
        }
    }

    private func setDraft(_ value: String?, for id: String) {
        editedDrafts.insert(id)
        preferences.drafts[id] = value
    }

    private func updateHost(_ id: String) {
        if id != selectedHostID { catalog = []; newSelection = ModelSelection(); agentAccounts = AgentAccountsSnapshot(available: false); accountsRequest += 1 }
        selectedHostID = id
    }
}
