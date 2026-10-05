import Foundation
import Observation
#if canImport(SkipFuse)
// Supplies the Compose-aware observation registrar in native Android builds.
// The dependency-free domain test target keeps the standard Observation registrar.
import SkipFuse
#endif

public enum SecondaryRoute: Identifiable {
    case models, projects, settings, checkouts
    case sessionDetails(String)
    case queue(String)
    case subagents(String)
    case changes(CapturedTurnChanges)
    case diff(DiffDocument)
    case pullRequest(PullRequest)
    public var id: String {
        switch self {
        case .models: return "models"
        case .projects: return "projects"
        case .settings: return "settings"
        case .checkouts: return "checkouts"
        case .sessionDetails(let id): return "session-details-" + id
        case .queue(let id): return "queue-" + id
        case .subagents(let id): return "subagents-" + id
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
    public private(set) var checkoutSelection = CheckoutSelection.current
    public private(set) var checkouts: [ProjectCheckout] = []
    public private(set) var loadingCheckouts = false
    public private(set) var checkoutError: String?
    public var newSelection = ModelSelection()
    public var catalog: [AgentModel] = []
    public var state: SessionState?
    public var sessionsVisible = false
    public var usesSessionPanel = false
    public var route: SecondaryRoute?
    public var busy = false
    public var busyMessageMode = MessageSendMode.queue
    public private(set) var pendingQueueActions: Set<String> = []
    public var restoring = true
    public private(set) var refreshingSessions = false
    public var error: String?
    public var organizations: [Organization] = []
    public var zeronAccounts: [ZeronAccount] = []
    public var isDemo = false
    public var preferences = LocalPreferences()
    public var sessionList: SessionListPreferences {
        get { preferences.sessionList }
        set { editedSessionList = true; preferences.sessionList = newValue; scheduleSave() }
    }
    public private(set) var feedbackSerial = 0
    public private(set) var feedback = InteractionFeedback.selection
    public private(set) var completionError: String?

    public var agentAccounts = AgentAccountsSnapshot(available: false)
    public var loadingAccounts = false
    public var accountsError: String?
    public var notificationAuthorization = NotificationAuthorization.notDetermined
    public var notificationError: String?
    public var fetchingModels = false
    public var changesAfterMessage: [String: CapturedTurnChanges] = [:]
    public var pendingChangeMessageIDs: Set<String> = []
    public var pullRequestsAfterMessage: [String: [PullRequest]] = [:]
    private var attachmentDrafts: [String: [LocalAttachment]] = [:]
    private var answerSubmissions: [String: AnswerSubmission] = [:]
    @ObservationIgnored private var queueEditOwners: [String: QueueEditOwner] = [:]
    @ObservationIgnored private var finishingQueueEdits: Set<String> = []

    private struct QueueEditOwner {
        let client: any ClientService
        let generation: Int
    }

    private struct AnswerSubmission {
        let input: InputRequest
        let token: UUID
        var submitted = false
    }

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
    @ObservationIgnored private var checkoutRequest = 0
    @ObservationIgnored private var loadedCheckoutContext: String?
    @ObservationIgnored private var loadingCheckoutContext: String?
    @ObservationIgnored private var selectedCheckoutContext: String?
    @ObservationIgnored private var renamingSessions: Set<String> = []
    @ObservationIgnored private var sessions: [String: SessionState] = [:]
    @ObservationIgnored private var capturing: Set<String> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var modelTask: Task<Void, Never>?
    @ObservationIgnored private var sessionsRefreshTask: Task<Void, Never>?
    @ObservationIgnored private var loadingPreferences = false
    @ObservationIgnored private var saveAfterRestore = false
    @ObservationIgnored private var editedDrafts: Set<String> = []
    @ObservationIgnored private var editedFavorites = false
    @ObservationIgnored private var editedBackground = false
    @ObservationIgnored private var editedTheme = false
    @ObservationIgnored private var editedHaptics = false
    @ObservationIgnored private var editedSounds = false
    @ObservationIgnored private var editedSessionList = false
    @ObservationIgnored private var editedDestination = false
    @ObservationIgnored private var destinationRestored = false
    @ObservationIgnored private var completionRequest = 0
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
    public var canChooseCheckout: Bool { signedIn && selectedSessionID == nil && !busy && project?.hostID == selectedHostID && project?.isRepository == true }
    public var checkoutContext: String { "\(generation):\(selectionGeneration):\(selectedHostID):\(selectedProjectID ?? ""):\(project?.path ?? "")" }
    public var checkoutLabel: String {
        switch checkoutSelection {
        case .current:
            let branch = checkouts.first(where: \.isCurrent)?.branch.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return branch.isEmpty ? "Current checkout" : branch
        case .newWorktree: return "New worktree"
        case .existing(let checkout): return checkout.branch.isEmpty ? "Existing checkout" : checkout.branch
        }
    }
    public var selection: ModelSelection { state?.selection ?? newSelection }
    public var selectedModel: AgentModel? { catalog.first { $0.providerID == selection.providerID && $0.modelID == selection.modelID } }
    public var modelName: String { selectedModel?.name ?? selection.modelID ?? "Choose model" }
    public var working: Bool { state?.working ?? false }
    public var answering: Bool { currentAnswerSubmission?.submitted == false }
    public var answerSubmitted: Bool { currentAnswerSubmission?.submitted == true }
    private var currentAnswerSubmission: AnswerSubmission? {
        guard let id = selectedSessionID, state?.id == id,
              let submission = answerSubmissions[id], state?.input == submission.input else { return nil }
        return submission
    }
    public var notificationsSupported: Bool { notifications.supported && !isDemo }
    public var usageWarning: UsageWarning? {
        preferences.usageWarnings.first {
            guard let source = $0.source else { return false }
            return !preferences.dismissedUsageSessions.contains(source.sessionID)
        }
    }
    public var changes: [CapturedTurnChanges] { preferences.changes.filter { $0.sessionID == selectedSessionID } }
    public var attachments: [LocalAttachment] { attachmentDrafts[selectedSessionID ?? "new"] ?? [] }
    public var attachmentContext: String { "\(generation):\(selectedSessionID ?? "new"):\(session?.hostID ?? selectedHostID):\(session?.projectID ?? selectedProjectID ?? "")" }
    public var transcriptText: String { (state?.messages ?? []).map { "\($0.role.capitalized):\n\($0.text)" }.joined(separator: "\n\n") }
    public var sessionPullRequests: [PullRequest] { preferences.pullRequests.filter { $0.sessionID == selectedSessionID }.map(\.request) }
    public func subagents(sessionID: String) -> [SubagentStatus] {
        let messages = state?.id == sessionID ? state?.messages : sessions[sessionID]?.messages
        var latest: [String: SubagentStatus] = [:]
        var order: [String] = []
        for agent in (messages ?? []).flatMap(\.subagents) {
            if latest[agent.id] == nil { order.append(agent.id) }
            latest[agent.id] = agent
        }
        return order.compactMap { latest[$0] }
    }
    public var activeSubagentCount: Int { selectedSessionID.map { subagents(sessionID: $0).filter(\.active).count } ?? 0 }
    public var sessionHostOffline: Bool {
        guard let session else { return false }
        return workspace.connection == .offline || workspace.hosts.first(where: { $0.id == session.hostID })?.online == false
    }
    public var unanchoredPullRequests: [PullRequest] {
        let visible = Set(state?.messages.map(\.id) ?? [])
        return preferences.pullRequests.filter { $0.sessionID == selectedSessionID && ($0.afterMessageID == nil || !visible.contains($0.afterMessageID!)) }.map(\.request)
    }
    public var draft: String {
        get { preferences.drafts[selectedSessionID ?? "new"] ?? "" }
        set { setDraft(newValue, for: selectedSessionID ?? "new"); scheduleSave() }
    }
    public var canSend: Bool {
        signedIn && !busy && (!working || canQueueDraft || canSteerDraft) && hasMessageDraft
            && !(session?.hostID ?? selectedHostID).isEmpty
            && (selectedSessionID != nil || newSelection.modelID != nil)
            && (selectedSessionID != nil || checkoutSelection == .current || selectedCheckoutContext == checkoutContext)
            && (selectedSessionID != nil || selectedCheckoutIsAvailable)
    }
    public var hasMessageDraft: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty }
    public var composerStops: Bool { working && !hasMessageDraft }
    public var canQueueDraft: Bool {
        state?.queueCapabilities.canQueue == true && (attachments.isEmpty || state?.queueCapabilities.canQueueAttachments == true)
    }
    public var canSteerDraft: Bool { attachments.isEmpty && state?.queueCapabilities.canSteer == true }
    public var messageSendMode: MessageSendMode {
        canSteerDraft && (busyMessageMode == .steer || !canQueueDraft) ? .steer : .queue
    }

    public func start() async {
        let epoch = generation
        defer { if epoch == generation { restoring = false } }
        do { try await client.restore() } catch { if epoch == generation { self.error = "Couldn't restore your session. Please sign in again." } }
    }

    /// Refresh the peer's workspace without replacing the current composer.
    /// Concurrent gestures share one request; account changes invalidate it.
    public func refreshSessions() async {
        guard signedIn, !Task.isCancelled else { return }
        if let task = sessionsRefreshTask { await task.value; return }
        let epoch = generation, source = client
        refreshingSessions = true
        emitFeedback(.refresh)
        // Resync can return before the next frame. Keep native refresh feedback
        // visible briefly without delaying a slower peer a second time.
        let feedbackDeadline = ContinuousClock.now.advanced(by: .milliseconds(500))
        let task = Task { [weak self] in
            guard let self else { return }
            defer {
                if epoch == self.generation {
                    self.refreshingSessions = false
                    self.sessionsRefreshTask = nil
                }
            }
            do { try await source.refresh() }
            catch {
                guard epoch == self.generation, !Task.isCancelled, !(error is CancellationError) else { return }
                self.error = "Couldn't refresh sessions. Try again when your connection is restored."
            }
            guard epoch == self.generation, !Task.isCancelled else { return }
            // This is presentation time, not confirmation of a remote update.
            try? await Task.sleep(until: feedbackDeadline, clock: .continuous)
        }
        sessionsRefreshTask = task
        await task.value
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
        do { try await client.restore(); zeronAccounts = client.zeronAccounts }
        catch { self.error = "Couldn't restore another signed-in account." }
    }

    public func switchAccount(_ id: String) async {
        guard !isDemo, id != client.accountKey else { return }
        generation += 1
        restoring = true
        defer { restoring = false }
        if let store { try? await store.save(preferences) }
        resetAccountState()
        bindClient()
        do {
            try await client.switchAccount(id)
            zeronAccounts = client.zeronAccounts
        } catch { self.error = "Couldn't switch accounts. Try again." }
    }

    private func resetAccountState() {
        saveTask?.cancel(); modelTask?.cancel(); notificationTask?.cancel(); accountsTask?.cancel()
        sessionsRefreshTask?.cancel(); sessionsRefreshTask = nil; refreshingSessions = false
        for task in notificationDeliveries.values { task.cancel() }
        notificationDeliveries = [:]; notificationDeliveryEvents = [:]; queuedNotifications = [:]; observedRunningSessions = []
        notifications.stop(); accountsRequest += 1; accountHostID = nil; accountSnapshotsByHost = [:]; pendingNotificationSession = nil
        agentAccounts = AgentAccountsSnapshot(available: false); loadingAccounts = false; accountsError = nil
        notificationAuthorization = notifications.supported ? .notDetermined : .unavailable; notificationError = nil
        modelRequest += 1; selectionGeneration += 1
        resetCheckoutSelection(); renamingSessions = []
        store = nil; restoredAccount = nil; capturing = []
        loadingPreferences = false; saveAfterRestore = false
        editedDrafts = []; editedFavorites = false; editedBackground = false; editedTheme = false; editedHaptics = false; editedNotifications = false
        editedSounds = false; editedSessionList = false; editedDestination = false; destinationRestored = false
        completionRequest += 1; completionError = nil
        changeSizes = [:]
        workspace = WorkspaceState(); sessions = [:]; state = nil
        selectedSessionID = nil; selectedProjectID = nil; selectedHostID = ""
        preferences = LocalPreferences(); catalog = []; route = nil; organizations = []; zeronAccounts = []; changesAfterMessage = [:]; pendingChangeMessageIDs = []
        attachmentDrafts = [:]; pullRequestsAfterMessage = [:]; answerSubmissions = [:]
        newSelection = ModelSelection()
        sessionsVisible = false; isDemo = false; busy = false; fetchingModels = false
        busyMessageMode = .queue; pendingQueueActions = []
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
            zeronAccounts = client.zeronAccounts
            let priorProject = previousWorkspace.projects.first { $0.id == selectedProjectID }
            let nextProject = next.projects.first { $0.id == selectedProjectID }
            if priorProject?.path != nextProject?.path || priorProject?.hostID != nextProject?.hostID || priorProject?.isRepository != nextProject?.isRepository {
                resetCheckoutSelection()
            }
            let sessionIDs = Set(next.sessions.map(\.id))
            answerSubmissions = answerSubmissions.filter { sessionIDs.contains($0.key) }
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
            if !destinationRestored && !loadingPreferences { restoreComposerDestination() }
            let oldActiveHosts = Set(previousWorkspace.sessions.filter(\.working).map(\.hostID))
            let activeHosts = Set(next.sessions.filter(\.working).map(\.hostID))
            if oldActiveHosts != activeHosts { restartUsageMonitoring() }
            openPendingNotification()
        case .session(let next):
            let previous = sessions[next.id]
            var next = next
            next.workingStartedAt = WorkingStatus.start(for: next, previous: previous, now: Date())
            sessions[next.id] = next
            if let submission = answerSubmissions[next.id], next.input != submission.input {
                answerSubmissions[next.id] = nil
            }
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
        resetCheckoutSelection()
        if let id = selectedSessionID { client.closeSession(id) }
        selectedSessionID = nil; state = nil; changesAfterMessage = [:]; pendingChangeMessageIDs = []; pullRequestsAfterMessage = [:]
        if !usesSessionPanel { sessionsVisible = false }
        restoreComposerDestination()
        loadModels()
    }

    public func open(_ id: String) async {
        selectionGeneration += 1
        resetCheckoutSelection()
        let epoch = generation
        let selectionEpoch = selectionGeneration
        if let old = selectedSessionID, old != id { client.closeSession(old) }
        let unread = workspace.sessions.first(where: { $0.id == id })?.unread ?? false
        if let index = workspace.sessions.firstIndex(where: { $0.id == id }) {
            workspace.sessions[index].unread = false
            rememberDestination(workspace.sessions[index])
        }
        selectedSessionID = id; state = sessions[id]
        if !usesSessionPanel { sessionsVisible = false }
        placeChangeCards()
        placePullRequestCards()
        do {
            try await client.openSession(id)
            guard epoch == generation, selectionEpoch == selectionGeneration else { return }
            loadModels()
        } catch {
            if epoch == generation, selectionEpoch == selectionGeneration {
                if unread, let index = workspace.sessions.firstIndex(where: { $0.id == id }) { workspace.sessions[index].unread = true }
                self.error = "Couldn't open this session. Try again when the host is online."
            }
        }
    }

    public func queuedMessages(sessionID: String) -> [QueuedMessage] {
        (state?.id == sessionID ? state : sessions[sessionID])?.queue ?? []
    }

    public func queueCapabilities(sessionID: String) -> MessageQueueCapabilities {
        (state?.id == sessionID ? state : sessions[sessionID])?.queueCapabilities ?? .init()
    }

    public func queueActionPending(sessionID: String, id: String) -> Bool {
        pendingQueueActions.contains(queueActionKey(sessionID: sessionID, id: id))
            || queuedMessages(sessionID: sessionID).first(where: { $0.id == id })?.actionPending == true
    }

    private func queueActionKey(sessionID: String, id: String) -> String { "\(generation):\(sessionID):\(id)" }

    public func sendQueuedNow(sessionID: String, id: String) async {
        await performQueueAction(sessionID: sessionID, id: id) { source in
            try await source.sendQueuedNow(sessionID: sessionID, id: id)
        }
    }

    public func moveQueuedMessage(sessionID: String, id: String, delta: Int) async {
        await performQueueAction(sessionID: sessionID, id: id) { source in
            try await source.moveQueuedMessage(sessionID: sessionID, id: id, delta: delta)
        }
    }

    public func deleteQueuedMessage(sessionID: String, id: String) async {
        await performQueueAction(sessionID: sessionID, id: id) { source in
            try await source.deleteQueuedMessage(sessionID: sessionID, id: id)
        }
    }

    private func performQueueAction(sessionID: String, id: String,
                                    operation: @MainActor (any ClientService) async throws -> Void) async {
        guard !queueActionPending(sessionID: sessionID, id: id) else { return }
        let key = queueActionKey(sessionID: sessionID, id: id), epoch = generation
        let source = client
        pendingQueueActions.insert(key)
        defer { pendingQueueActions.remove(key) }
        do { try await operation(source) }
        catch { if epoch == generation && selectedSessionID == sessionID { self.error = "Couldn't update the queued message. Check the queue before trying again." } }
    }

    public func beginQueuedMessageEdit(sessionID: String, id: String) async -> QueuedMessageEdit? {
        guard !queueActionPending(sessionID: sessionID, id: id) else { return nil }
        let key = queueActionKey(sessionID: sessionID, id: id), epoch = generation
        let source = client
        pendingQueueActions.insert(key)
        defer { pendingQueueActions.remove(key) }
        do {
            let edit = try await source.beginQueuedMessageEdit(sessionID: sessionID, id: id)
            guard epoch == generation, selectedSessionID == sessionID else {
                try? await source.finishQueuedMessageEdit(edit, text: nil)
                return nil
            }
            queueEditOwners[edit.leaseID] = QueueEditOwner(client: source, generation: epoch)
            return edit
        } catch {
            if epoch == generation && selectedSessionID == sessionID { self.error = "Couldn't edit this queued message. Check that the host supports queue editing." }
            return nil
        }
    }

    public func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async -> Bool {
        guard let owner = queueEditOwners[edit.leaseID], owner.generation == generation, selectedSessionID == edit.sessionID else { return false }
        do {
            let renewed = try await owner.client.renewQueuedMessageEdit(edit)
            return renewed && owner.generation == generation && selectedSessionID == edit.sessionID
        }
        catch { return false }
    }

    @discardableResult public func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async -> Bool {
        guard let owner = queueEditOwners[edit.leaseID], !finishingQueueEdits.contains(edit.leaseID) else { return false }
        finishingQueueEdits.insert(edit.leaseID)
        defer { finishingQueueEdits.remove(edit.leaseID) }
        // A dismissed/account-switched editor releases through the client that
        // acquired its lease, never a newly signed-in account's client.
        let current = owner.generation == generation && selectedSessionID == edit.sessionID
        do {
            try await owner.client.finishQueuedMessageEdit(edit, text: current ? text : nil)
            queueEditOwners[edit.leaseID] = nil
            return owner.generation == generation && selectedSessionID == edit.sessionID
        } catch {
            let stillCurrent = owner.generation == generation && selectedSessionID == edit.sessionID
            if text == nil || !stillCurrent { queueEditOwners[edit.leaseID] = nil }
            if stillCurrent && text != nil { self.error = "Couldn't save the queued message. Your edit is still here." }
            return false
        }
    }

    public func send(busyMode: MessageSendMode? = nil) async {
        guard canSend, !working || busyMode != .queue || canQueueDraft else { return }
        busy = true
        let epoch = generation
        let selectionEpoch = selectionGeneration
        let source = client
        defer { if epoch == generation { busy = false } }
        let text = draft
        let submittedAttachments = attachments
        let submittedMode = busyMode ?? messageSendMode
        let oldDraftKey = selectedSessionID ?? "new"
        do {
            let id: String
            if let selectedSessionID { id = selectedSessionID }
            else {
                id = try await source.createSession(projectID: selectedProjectID, hostID: selectedHostID, selection: newSelection, checkout: checkoutSelection)
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
            try await source.send(sessionID: id, text: text, attachments: submittedAttachments, busy: submittedMode)
            guard epoch == generation else { return }
            emitFeedback(.send)
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
        completionRequest += 1
        let request = completionRequest, epoch = generation, selected = selectionGeneration
        let host = session?.hostID ?? selectedHostID
        let provider = selection.providerID
        let project = session?.projectID ?? selectedProjectID
        completionError = nil
        guard !host.isEmpty else { return [] }
        do {
            // Host workspace targets are exclusive: a chat already identifies
            // its project and checkout. Sending both IDs rejects every lookup.
            let result = try await client.complete(kind: kind, query: query, hostID: host,
                sessionID: selectedSessionID, projectID: selectedSessionID == nil ? project : nil, providerID: provider)
            guard !Task.isCancelled, epoch == generation, selected == selectionGeneration,
                  request == completionRequest, host == (session?.hostID ?? selectedHostID), provider == selection.providerID,
                  project == (session?.projectID ?? selectedProjectID) else { return [] }
            return result
        } catch {
            if !Task.isCancelled, !(error is CancellationError), epoch == generation,
               selected == selectionGeneration, request == completionRequest {
                completionError = "Couldn't load suggestions from your desktop. Try again."
            }
            return []
        }
    }
    public func setPinned(_ session: Session, pinned: Bool) async {
        let epoch = generation
        do { try await client.setPinned(sessionID: session.id, pinned: pinned) }
        catch { if epoch == generation { self.error = "Couldn't update the pinned session." } }
    }
    public func togglePin(_ session: Session) async { await setPinned(session, pinned: !session.pinned) }
    public func sessionDetailsContext(_ sessionID: String) -> String { "\(generation):\(sessionID)" }
    public func renameSession(sessionID: String, title: String, context: String) async throws {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard context == sessionDetailsContext(sessionID) else { throw CancellationError() }
        guard signedIn, !Task.isCancelled, !clean.isEmpty,
              let original = workspace.sessions.first(where: { $0.id == sessionID }),
              renamingSessions.insert(sessionID).inserted else { throw ClientFailure("This session can't be renamed right now.") }
        let epoch = generation, source = client
        defer { if epoch == generation { renamingSessions.remove(sessionID) } }
        do {
            try await source.renameSession(sessionID: sessionID, title: clean)
            guard epoch == generation, workspace.sessions.contains(where: { $0.id == sessionID && $0.hostID == original.hostID && $0.projectID == original.projectID }) else { throw CancellationError() }
        } catch {
            guard epoch == generation else { throw CancellationError() }
            throw error
        }
    }
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
    public func setTheme(_ theme: AppTheme) { editedTheme = true; preferences.theme = theme; scheduleSave() }
    public func setHapticsEnabled(_ enabled: Bool) { editedHaptics = true; preferences.hapticsEnabled = enabled; scheduleSave() }
    public func setSoundsEnabled(_ enabled: Bool) { editedSounds = true; preferences.soundsEnabled = enabled; scheduleSave() }
    public func emitFeedback(_ event: InteractionFeedback) {
        guard foreground else { return }
        feedback = event; feedbackSerial &+= 1
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
    public func setBackgroundFullHeight(_ enabled: Bool) {
        editedBackground = true; preferences.backgroundFullHeight = enabled; scheduleSave()
    }
    public func dismissUsageWarning() {
        guard let id = usageWarning?.source?.sessionID else { return }
        preferences.dismissedUsageSessions.insert(id)
        preferences.usageWarnings.removeAll { $0.source?.sessionID == id }
        scheduleSave()
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
                if !row.failed { emitFeedback(.finished) }
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

    private func observeUsageWarnings(_ snapshot: AgentAccountsSnapshot, hostID: String) {
        guard snapshot.available else { return }
        var observations: [UsageWarning] = []
        for row in workspace.sessions where row.hostID == hostID && !preferences.dismissedUsageSessions.contains(row.id) {
            let existing = preferences.usageWarnings.first { $0.source?.sessionID == row.id }
            guard row.working || row.id == selectedSessionID || existing != nil else { continue }
            let currentSelection = row.providerID.isEmpty ? (sessions[row.id]?.selection ?? ModelSelection()) : ModelSelection(providerID: row.providerID, modelID: row.modelID)
            // Refresh the warning's original provider if the session model changed.
            let selection = existing?.source.map { ModelSelection(providerID: $0.providerID, modelID: $0.modelID) } ?? currentSelection
            guard let account = UsageLimitRules.account(accounts: snapshot.accounts, selection: selection),
                  var warning = UsageLimitRules.warning(remaining: account.remainingFraction),
                  let fetchedAt = account.usageFetchedAt else { continue }
            warning.source = UsageWarningSource(sessionID: row.id, hostID: hostID, providerID: selection.providerID,
                accountID: account.id, upstreamProviderID: account.provider, modelID: selection.modelID,
                observedAt: Date(timeIntervalSince1970: Double(fetchedAt) / 1000))
            observations.append(warning)
        }
        let retained = UsageLimitRules.mergeWarnings(preferences.usageWarnings, observations: observations,
            dismissed: preferences.dismissedUsageSessions)
        if retained != preferences.usageWarnings { preferences.usageWarnings = retained; scheduleSave() }
    }

    private func observeUsageThreshold(previous: AgentAccountsSnapshot, next: AgentAccountsSnapshot, hostID: String) {
        observeUsageWarnings(next, hostID: hostID)
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
    public func setHost(_ id: String) { selectionGeneration += 1; resetCheckoutSelection(); updateHost(id); selectedProjectID = nil; saveComposerDestination(); loadModels() }
    public func selectProject(_ project: Project) { selectionGeneration += 1; resetCheckoutSelection(); updateHost(project.hostID); selectedProjectID = project.id; saveComposerDestination(); loadModels(); route = nil }
    public func loadCheckouts() async {
        guard canChooseCheckout, let project else { return }
        let context = checkoutContext
        guard loadingCheckoutContext != context else { return }
        checkoutRequest += 1
        let request = checkoutRequest, epoch = generation, source = client
        loadingCheckouts = true; loadingCheckoutContext = context; checkoutError = nil
        if loadedCheckoutContext != context { checkouts = [] }
        defer {
            if epoch == generation, request == checkoutRequest { loadingCheckouts = false; loadingCheckoutContext = nil }
        }
        do {
            let values = try await source.checkouts(projectID: project.id, hostID: project.hostID)
            guard !Task.isCancelled, epoch == generation, request == checkoutRequest, context == checkoutContext else { return }
            var paths: Set<String> = []
            checkouts = values.filter { !$0.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && paths.insert($0.path).inserted }
            loadedCheckoutContext = context
            if case .existing(let selected) = checkoutSelection, !checkouts.contains(selected) {
                checkoutError = "The selected checkout is no longer available. Choose a checkout before sending."
            }
        } catch {
            guard !Task.isCancelled, !(error is CancellationError), epoch == generation, request == checkoutRequest, context == checkoutContext else { return }
            checkoutError = "Couldn't load checkouts. Try again when the host is online."
        }
    }
    @discardableResult
    public func selectCheckout(_ selection: CheckoutSelection, context: String) -> Bool {
        guard canChooseCheckout, context == checkoutContext else { return false }
        if case .existing(let checkout) = selection {
            guard loadedCheckoutContext == context, checkouts.contains(checkout) else { return false }
        }
        checkoutSelection = selection
        selectedCheckoutContext = context
        saveComposerDestination()
        route = nil
        return true
    }
    private func saveComposerDestination() {
        editedDestination = true; destinationRestored = true
        preferences.composerDestination.hostID = selectedHostID
        preferences.composerDestination.projectID = selectedProjectID
        preferences.composerDestination.checkout = checkoutSelection
        scheduleSave()
    }

    private func rememberDestination(_ session: Session) {
        guard let project = workspace.projects.first(where: { $0.id == session.projectID && $0.hostID == session.hostID }) else { return }
        editedDestination = true
        preferences.composerDestination.hostID = session.hostID
        preferences.composerDestination.projectID = project.id
        if project.isRepository, !session.path.isEmpty, session.path != project.path {
            preferences.composerDestination.checkout = .existing(ProjectCheckout(branch: session.branch ?? "", path: session.path))
        } else { preferences.composerDestination.checkout = .current }
        scheduleSave()
    }

    private func restoreComposerDestination() {
        guard selectedSessionID == nil, !busy else { return }
        let saved = preferences.composerDestination
        guard workspace.hosts.contains(where: { $0.id == saved.hostID }) else { return }
        if let id = saved.projectID, !workspace.projects.contains(where: { $0.id == id && $0.hostID == saved.hostID }) { return }
        updateHost(saved.hostID)
        selectedProjectID = saved.projectID
        checkoutSelection = project?.isRepository == true ? saved.checkout : .current
        selectedCheckoutContext = checkoutContext
        destinationRestored = true
        loadModels()
        if case .existing = checkoutSelection {
            Task { await loadCheckouts() }
        }
    }

    private func resetCheckoutSelection() {
        checkoutRequest += 1
        checkoutSelection = .current; checkouts = []; checkoutError = nil; loadingCheckouts = false
        loadedCheckoutContext = nil; loadingCheckoutContext = nil
        selectedCheckoutContext = nil
    }
    private var selectedCheckoutIsAvailable: Bool {
        guard case .existing(let selected) = checkoutSelection else { return true }
        return loadedCheckoutContext == checkoutContext && checkouts.contains(selected)
    }
    public func folders(hostID: String, path: String?) async throws -> FolderPage { try await client.listFolders(hostID: hostID, path: path) }
    public func addProject(hostID: String, folder: RemoteFolder) async throws {
        let epoch = generation
        let id = try await client.addProject(hostID: hostID, path: folder.path, isRepository: folder.isRepository)
        guard epoch == generation else { throw CancellationError() }
        selectionGeneration += 1; resetCheckoutSelection()
        updateHost(hostID); selectedProjectID = id; saveComposerDestination(); loadModels(); route = nil
    }
    public func createProject(hostID: String, name: String) async throws {
        let epoch = generation
        let id = try await client.createRepository(hostID: hostID, name: name)
        guard epoch == generation else { throw CancellationError() }
        selectionGeneration += 1; resetCheckoutSelection()
        updateHost(hostID); selectedProjectID = id; saveComposerDestination(); loadModels(); route = nil
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
        } catch {
            if epoch == generation {
                self.error = (error as? ClientFailure)?.message ?? "Sign-in couldn't finish on this device. Please try again."
            }
        }
    }
    public func chooseOrganization(_ id: String) async {
        let epoch = generation
        do {
            try await client.selectOrganization(id)
            if epoch == generation { organizations = []; zeronAccounts = client.zeronAccounts }
        }
        catch {
            if epoch == generation {
                self.error = (error as? ClientFailure)?.message ?? "Couldn't save or open this account on this device."
            }
        }
    }
    @discardableResult
    public func answer(sessionID: String, input: InputRequest, answers: [String: [String]]) async -> Bool {
        guard signedIn, !Task.isCancelled, selectedSessionID == sessionID, state?.id == sessionID,
              state?.input == input, QuestionAnswerDraft.validAnswers(answers, for: input),
              answerSubmissions[sessionID]?.input != input else { return false }
        let epoch = generation, selected = selectionGeneration, source = client
        let token = UUID()
        answerSubmissions[sessionID] = AnswerSubmission(input: input, token: token)
        do {
            try await source.respondInput(sessionID: sessionID, requestID: input.id, answers: answers)
            guard epoch == generation else { return false }
            // The peer queues this command before the host resolves its question.
            // Keep one record per live session until its input changes or clears.
            if answerSubmissions[sessionID]?.token == token { answerSubmissions[sessionID]?.submitted = true }
            return true
        } catch {
            guard epoch == generation, answerSubmissions[sessionID]?.token == token else { return false }
            answerSubmissions[sessionID] = nil
            if selected == selectionGeneration, selectedSessionID == sessionID, state?.id == sessionID,
               state?.input == input, !Task.isCancelled, !(error is CancellationError) {
                self.error = "Couldn't send your answer. Please try again."
            }
            return false
        }
    }
    public func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        client.setForeground(foreground)
        if foreground { syncNotifications(); restartUsageMonitoring() }
        else {
            accountsTask?.cancel()
            // Do not leave the last edit waiting on the debounce at suspension.
            if let store, !isDemo, !loadingPreferences {
                saveTask?.cancel()
                let value = preferences
                saveTask = Task { try? await store.save(value) }
            }
        }
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
        placeChangeCards()
        let currentGeneration = generation
        let source = client
        Task { [weak self] in
            guard let self, currentGeneration == self.generation else { return }
            defer {
                if currentGeneration == self.generation {
                    self.capturing.remove(key)
                    self.placeChangeCards()
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
                guard currentGeneration == self.generation, self.sessions[session.id]?.turnID == turn,
                      self.sessions[session.id]?.working == false, !snapshot.files.isEmpty else { return }
                self.preferences.changes.append(snapshot)
                // Publish the captured revision before persistence bookkeeping.
                self.placeChangeCards()
                let sizes = await Self.measureChanges([snapshot])
                guard currentGeneration == self.generation else { return }
                self.changeSizes.merge(sizes) { _, next in next }
                self.trimChanges()
                self.placeChangeCards()
                self.scheduleSave()
            } catch { /* Older hosts and expired turn snapshots have no completion card. */ }
        }
    }

    private func placeChangeCards() {
        changesAfterMessage = [:]
        pendingChangeMessageIDs = []
        guard let state else { return }
        let turns = changes
        for turn in turns {
            guard let start = state.messages.firstIndex(where: { $0.id == turn.turnID }) else { continue }
            let nextUser = state.messages.indices.first { $0 > start && state.messages[$0].role == "user" } ?? state.messages.endIndex
            let end = max(start, nextUser - 1)
            changesAfterMessage[state.messages[end].id] = turn
        }
        if !state.working, let turnID = state.turnID,
           capturing.contains(state.id + ":" + turnID),
           !turns.contains(where: { $0.turnID == turnID }),
           let start = state.messages.firstIndex(where: { $0.id == turnID }) {
            let nextUser = state.messages.indices.first { $0 > start && state.messages[$0].role == "user" } ?? state.messages.endIndex
            pendingChangeMessageIDs.insert(state.messages[max(start, nextUser - 1)].id)
        }
    }

    private func observePullRequests() {
        var changed = false
        for session in workspace.sessions {
            guard let request = session.pullRequest else { continue }
            let messages = session.id == selectedSessionID ? state?.messages : sessions[session.id]?.messages
            let anchor = messages?.last(where: { $0.role == "assistant" })?.id
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
                if self.editedSessionList { merged.sessionList = self.preferences.sessionList; self.saveAfterRestore = true }
                if self.editedDestination { merged.composerDestination = self.preferences.composerDestination; self.saveAfterRestore = true }
                if self.editedSounds { merged.soundsEnabled = self.preferences.soundsEnabled; self.saveAfterRestore = true }
                if self.editedFavorites { merged.favorites = self.preferences.favorites }
                if self.editedTheme { merged.theme = self.preferences.theme }
                if self.editedHaptics {
                    merged.hapticsEnabled = self.preferences.hapticsEnabled
                    self.saveAfterRestore = true
                }
                if self.editedBackground {
                    merged.backgroundEnabled = self.preferences.backgroundEnabled
                    merged.backgroundImageData = self.preferences.backgroundImageData
                    merged.backgroundImageName = self.preferences.backgroundImageName
                    merged.backgroundEffect = self.preferences.backgroundEffect
                    merged.backgroundFullHeight = self.preferences.backgroundFullHeight
                }
                if self.editedNotifications { merged.notifications = self.preferences.notifications }
                merged.dismissedUsageSessions.formUnion(self.preferences.dismissedUsageSessions)
                merged.usageWarnings = UsageLimitRules.mergeWarnings(merged.usageWarnings, observations: self.preferences.usageWarnings,
                    dismissed: merged.dismissedUsageSessions)
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
                if !self.preferences.pullRequests.isEmpty || !self.preferences.sessionFinishedAt.isEmpty || !self.preferences.usageWarnings.isEmpty { self.saveAfterRestore = true }
                self.preferences = merged
                for index in self.workspace.sessions.indices where self.workspace.sessions[index].lastFinishedAt == nil {
                    self.workspace.sessions[index].lastFinishedAt = merged.sessionFinishedAt[self.workspace.sessions[index].id]
                }
                self.changeSizes.merge(sizes) { current, _ in current }
                self.loadingPreferences = false
                self.restoreComposerDestination()
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
