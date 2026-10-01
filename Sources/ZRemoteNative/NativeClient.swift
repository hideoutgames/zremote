import Foundation
import SkipKeychain
import ZRemoteCore

/// One account-scoped, engine-free peer. Rust owns sync, durable delivery and
/// host RPC; this adapter owns secure credentials and presentation projections.
@MainActor public final class NativeClient: ClientService {
    public var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    public let isDemo = false
    public var accountKey: String? { account.map { $0.userID + "/" + $0.organizationID } }

    private let edgeURL: String
    private var client: CoreClient?
    private var account: StoredAccount?
    private var pendingAuth: AuthExchange?
    private var pendingOrganizations: [AuthOrg] = []
    private var generation = UUID()
    private var handles: [String: SessionHandle] = [:]
    private var projections: [String: MessageCache] = [:]
    private var listener: NativeListener?
    private var refreshTask: Task<Void, Never>?
    private var dirtySessions: Set<String> = []
    private var workspaceDirty = false

    private static let credentialKey = "games.hideout.zremote.native.account.v1"
    private static let deviceKey = "games.hideout.zremote.native.device.v1"

    public init(edgeURL: String = "https://edge.zeron.sh") { self.edgeURL = edgeURL }

    deinit { client?.shutdown() }

    public func restore() async throws {
        guard client == nil else { return }
        guard let value = try Keychain.shared.string(forKey: Self.credentialKey) else {
            onUpdate?(.workspace(.init()))
            return
        }
        let stored = try JSONDecoder().decode(StoredAccount.self, from: Data(value.utf8))
        try await start(stored)
    }

    public func authorizationURL(state: String) throws -> URL {
        guard !state.isEmpty, let url = URL(string: workosAuthorizeUrl(state: state)) else {
            throw NativeClientError.invalidAuthentication
        }
        return url
    }

    public func exchangeCode(_ code: String) async throws -> [Organization] {
        let operation = generation
        pendingAuth = nil
        pendingOrganizations = []
        guard !code.isEmpty else { throw NativeClientError.invalidAuthentication }
        let result = try await authExchangeCode(edgeUrl: edgeURL, code: code)
        let organizations = try await authListOrgs(edgeUrl: edgeURL, accessToken: result.tokens.accessToken)
        guard generation == operation else { throw CancellationError() }
        guard !organizations.isEmpty else { throw NativeClientError.noOrganization }
        pendingAuth = result
        pendingOrganizations = organizations
        return organizations.map { Organization(id: $0.organizationId, name: $0.name) }
    }

    public func selectOrganization(_ id: String) async throws {
        let operation = generation
        guard let pendingAuth, pendingOrganizations.contains(where: { $0.organizationId == id }) else {
            throw NativeClientError.invalidAuthentication
        }
        let tokens = try await authRefresh(edgeUrl: edgeURL, refreshToken: pendingAuth.tokens.refreshToken, organizationId: id)
        guard generation == operation else { throw CancellationError() }
        let stored = StoredAccount(userID: pendingAuth.user.id, organizationID: id, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken)
        // Persist the rotated pair before starting rooms: the old pair is spent.
        try save(stored)
        self.pendingAuth = nil
        pendingOrganizations = []
        try await start(stored)
    }

    public func signOut() async throws {
        let previous = account
        shutdown()
        try Keychain.shared.removeValue(forKey: Self.credentialKey)
        account = nil
        pendingAuth = nil
        pendingOrganizations = []
        if let previous {
            let directory = try accountDirectory(previous)
            if FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.removeItem(at: directory)
            }
        }
        onUpdate?(.workspace(.init()))
    }

    public func refresh() async throws {
        guard let client else { onUpdate?(.workspace(.init())); return }
        client.onForeground()
        publishWorkspace(client)
        for id in handles.keys { publishSession(id) }
    }

    public func openSession(_ id: String) async throws {
        let core = try requireClient()
        if handles[id] == nil { handles[id] = try core.openSession(chatId: id) }
        handles[id]?.setViewAttached(attached: true)
        core.markSeen(chatId: id)
        publishSession(id)
    }

    public func closeSession(_ id: String) {
        handles.removeValue(forKey: id)?.setViewAttached(attached: false)
        projections[id] = nil
        client?.closeSession(chatId: id)
    }

    public func models(hostID: String) async throws -> [AgentModel] {
        let operation = generation
        let core = try requireClient()
        guard core.executionDevices().contains(where: { $0.id == hostID }) else { throw NativeClientError.noHost }
        let providers = await core.listHarnesses(deviceId: hostID)
        try ensureCurrent(operation)
        var result: [AgentModel] = []
        // Official core queries this host and falls back to its persisted catalog
        // or the upstream curated list when unreachable. No app-owned live fixtures.
        for provider in providers where provider.offered {
            let models = await core.listModels(deviceId: hostID, harness: provider.id)
            try ensureCurrent(operation)
            result += models.map { model in
                AgentModel(providerID: provider.id, providerName: provider.label, modelID: model.id, name: model.label,
                    detail: model.description ?? "", efforts: model.reasoningLevels.isEmpty ? provider.reasoningLevels : model.reasoningLevels,
                    options: model.options.map { option in
                        ZRemoteCore.ModelOption(id: option.id, label: option.label,
                            choices: option.choices.map { ModelChoice(id: $0.id, label: $0.label) }, defaultChoice: option.defaultChoice)
                    })
            }
        }
        return result
    }

    public func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String {
        let core = try requireClient()
        guard core.executionDevices().contains(where: { $0.id == hostID }) else { throw NativeClientError.noHost }
        if let projectID, core.project(spaceId: projectID)?.deviceId != hostID { throw NativeClientError.noHost }
        let target: SessionTarget = projectID.map { .project(spaceId: $0) } ?? .projectless(deviceId: hostID)
        let id = try core.createSession(newSession: NewSession(target: target, config: config(selection), branch: nil, cwd: nil, title: nil))
        try await openSession(id)
        publishWorkspace(core)
        return id
    }

    public func send(sessionID: String, text: String) async throws {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let handle = try requireHandle(sessionID)
        _ = try handle.send(request: SendRequest(text: text, attachments: [], worktree: nil, busy: .queue))
        publishSession(sessionID)
    }

    public func interrupt(sessionID: String) async throws { try requireHandle(sessionID).interrupt() }

    public func retryDelivery(sessionID: String) async throws {
        try requireHandle(sessionID).retryDelivery()
        publishSession(sessionID)
    }

    public func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws {
        try requireHandle(sessionID).respondInput(requestId: requestID,
            answers: answers.map { UserInputAnswer(questionId: $0.key, labels: $0.value) })
    }

    public func setModel(sessionID: String, selection: ModelSelection) async throws {
        let core = try requireClient()
        guard let existing = core.sessionConfig(chatId: sessionID), existing.harness == selection.providerID else {
            throw NativeClientError.lockedProvider
        }
        var next = config(selection)
        next.sandbox = existing.sandbox
        try core.setSessionConfig(chatId: sessionID, config: next)
        publishSession(sessionID)
    }

    public func listFolders(hostID: String, path: String?) async throws -> FolderPage {
        let operation = generation
        let listing = try await requireClient().listFolders(deviceId: hostID, path: path)
        try ensureCurrent(operation)
        let separator = listing.path.contains("\\") ? "\\" : "/"
        var clean = listing.path
        while clean.count > 1 && clean.hasSuffix(separator) { clean.removeLast() }
        let index = clean.lastIndex(of: Character(separator))
        let candidateParent = index.map { offset -> String in
            let prefix = String(clean[..<offset])
            if prefix.isEmpty { return separator }
            if prefix.hasSuffix(":") { return prefix + separator }
            return prefix
        }
        let folders = listing.entries.filter { $0.isDir && $0.name.lowercased() != ".git" }.map {
            RemoteFolder(name: $0.name, path: listing.path + (listing.path.hasSuffix(separator) ? "" : separator) + $0.name, isRepository: $0.isRepo)
        }
        let parent = candidateParent == listing.path || candidateParent == clean ? nil : candidateParent
        return FolderPage(path: listing.path, parent: parent, folders: folders, partial: listing.truncated)
    }

    public func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String {
        let operation = generation
        let id = try await requireClient().createProject(deviceId: hostID, path: path, gitDetected: isRepository)
        try ensureCurrent(operation)
        return id
    }

    public func createRepository(hostID: String, name: String) async throws -> String {
        let operation = generation
        let id = try await requireClient().createRepository(deviceId: hostID, name: name)
        try ensureCurrent(operation)
        return id
    }

    public func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff {
        let operation = generation
        let value = try await requireClient().latestTurnDiffJson(chatId: sessionID, expectedTurnId: turnID)
        try ensureCurrent(operation)
        let snapshot = try JSONDecoder().decode(DiffEnvelope.self, from: Data(value.utf8))
        return TurnDiff(patch: snapshot.patch, paths: snapshot.files.map(\.path), additions: snapshot.additions, deletions: snapshot.deletions, partial: snapshot.truncated)
    }

    public func setForeground(_ foreground: Bool) {
        if foreground { client?.onForeground() } else { client?.onBackground() }
    }

    private func start(_ stored: StoredAccount) async throws {
        guard let edge = URL(string: edgeURL), edge.scheme == "https", edge.user == nil, edge.password == nil, edge.query == nil else {
            throw NativeClientError.invalidEndpoint
        }
        shutdown()
        account = nil
        let directory = try accountDirectory(stored)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        account = stored
        let deviceID: String
        if let existing = UserDefaults.standard.string(forKey: Self.deviceKey) { deviceID = existing }
        else {
            deviceID = "zremote-" + UUID().uuidString.lowercased()
            UserDefaults.standard.set(deviceID, forKey: Self.deviceKey)
        }
        #if os(Android)
        let platform = "android"
        #else
        let platform = "ios"
        #endif
        let config = CoreConfig(edgeUrl: edgeURL, dataDir: directory.path, deviceId: deviceID,
            deviceName: "Zeron " + platform.capitalized, platform: platform,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
        let currentGeneration = generation
        let bridge = NativeListener { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                self.receive(event)
            }
        }
        listener = bridge
        let credentials = Credentials.workOs(userId: stored.userID, orgId: stored.organizationID,
            tokens: AuthTokens(accessToken: stored.accessToken, refreshToken: stored.refreshToken))
        let core: CoreClient
        do {
            core = try await Task.detached(priority: .userInitiated) {
                try CoreClient(config: config, credentials: credentials, listener: bridge)
            }.value
        } catch {
            if generation == currentGeneration { shutdown(); account = nil }
            throw error
        }
        guard generation == currentGeneration else { core.shutdown(); throw CancellationError() }
        client = core
        publishWorkspace(core)
    }

    private func shutdown() {
        generation = UUID()
        refreshTask?.cancel()
        refreshTask = nil
        dirtySessions.removeAll()
        workspaceDirty = false
        client?.shutdown()
        client = nil
        listener = nil
        handles.removeAll()
        projections.removeAll()
    }

    private func receive(_ event: ClientEvent) {
        switch event {
        case .authRefreshed(let tokens):
            guard var stored = account else { return }
            stored.accessToken = tokens.accessToken
            stored.refreshToken = tokens.refreshToken
            do { try save(stored); account = stored }
            catch { shutdown(); onUpdate?(.authenticationExpired) }
        case .authExpired:
            shutdown()
            onUpdate?(.authenticationExpired)
        case .workspaceChanged, .connectivityChanged:
            workspaceDirty = true
        case .sessionChanged(let id, _), .composerChanged(let id, _):
            dirtySessions.insert(id)
        }
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            // Coalesce a burst before publishing on the main actor.
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            self.refreshTask = nil
            if self.workspaceDirty, let core = self.client { self.publishWorkspace(core) }
            self.workspaceDirty = false
            let sessions = self.dirtySessions
            self.dirtySessions.removeAll()
            for id in sessions { self.publishSession(id) }
        }
    }

    private func publishWorkspace(_ core: CoreClient) {
        let snapshot = core.workspace()
        let ordered = snapshot.front.pinned + snapshot.front.sections.flatMap(\.sessions) + snapshot.front.recent
        var seen: Set<String> = []
        let sessions = ordered.filter { seen.insert($0.id).inserted }.map { row in
            let request = row.pullRequest.map { pr in
                ZRemoteCore.PullRequest(number: pr.number, title: pr.title, url: pr.url,
                    state: pr.state == .open ? "open" : pr.state == .merged ? "merged" : "closed")
            }
            return Session(id: row.id, title: row.title, projectID: row.project?.id, hostID: row.deviceId,
                path: row.cwd ?? "", preview: row.preview ?? "", working: row.indicator == .working,
                unread: row.unseen, pullRequest: request)
        }
        let connection: ClientConnection
        switch core.connectivity().state {
        case .connected: connection = .online
        case .offline: connection = .offline
        case .reconnecting, .disabled: connection = .connecting
        }
        onUpdate?(.workspace(WorkspaceState(connection: connection,
            hosts: snapshot.devices.filter(\.isExecutionHost).map { Host(id: $0.id, name: $0.name, online: $0.online) },
            projects: snapshot.projects.map { Project(id: $0.id, name: $0.name, path: $0.path, hostID: $0.deviceId) }, sessions: sessions)))
    }

    private func publishSession(_ id: String) {
        guard let handle = handles[id], let core = client else { return }
        var cache = projections[id] ?? MessageCache()
        let update = handle.transcriptUpdate(known: cache.revisions)
        for row in update.changed {
            cache.revisions[row.id] = row.revision
            cache.messages[row.id] = TranscriptMessage(id: row.id, role: row.role, text: row.text, streaming: row.streaming)
        }
        let present = Set(update.orderedIds)
        cache.revisions = cache.revisions.filter { present.contains($0.key) }
        cache.messages = cache.messages.filter { present.contains($0.key) }
        projections[id] = cache
        let composer = handle.composer()
        let config = core.sessionConfig(chatId: id)
        let input = composer.openInput.map { input in
            ZRemoteCore.InputRequest(id: input.requestId, questions: input.questions.map {
                InputQuestion(id: $0.id, title: $0.question, options: $0.options, multiple: $0.multiSelect)
            })
        }
        let delivery: String
        switch composer.sendState {
        case .sending: delivery = "Sending"
        case .queued: delivery = "Waiting for host"
        case .failed: delivery = "Not delivered"
        case nil: delivery = ""
        }
        let visibleMessages = update.orderedIds.compactMap { cache.messages[$0] }
            .filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        onUpdate?(.session(SessionState(id: id, messages: visibleMessages,
            selection: ModelSelection(providerID: config?.harness ?? "claude-code", modelID: config?.model,
                effort: config?.reasoning, options: config?.modelOptions ?? [:]),
            working: composer.live.turnRunning, delivery: delivery, deliveryFailed: composer.sendState == .failed,
            turnID: update.turnId, input: input)))
    }

    private func requireClient() throws -> CoreClient {
        guard let client else { throw NativeClientError.signedOut }
        return client
    }

    private func ensureCurrent(_ operation: UUID) throws {
        guard generation == operation else { throw CancellationError() }
    }

    private func requireHandle(_ id: String) throws -> SessionHandle {
        guard let handle = handles[id] else { throw NativeClientError.sessionClosed }
        return handle
    }

    private func config(_ selection: ModelSelection) -> ChatConfig {
        ChatConfig(harness: selection.providerID, model: selection.modelID, reasoning: selection.effort,
            modelOptions: selection.options, sandbox: .workspaceWrite)
    }

    private func accountDirectory(_ stored: StoredAccount) throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let identity = Data((stored.userID + "/" + stored.organizationID).utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "")
        guard !identity.isEmpty, identity.count < 240 else { throw NativeClientError.invalidAuthentication }
        return support.appendingPathComponent("ZRemoteNative/accounts", isDirectory: true).appendingPathComponent(identity, isDirectory: true)
    }

    private func save(_ stored: StoredAccount) throws {
        let data = try JSONEncoder().encode(stored)
        guard let value = String(data: data, encoding: .utf8) else { throw NativeClientError.invalidAuthentication }
        try Keychain.shared.set(value, forKey: Self.credentialKey, access: .unlockedThisDeviceOnly)
    }
}

private struct StoredAccount: Codable {
    var userID: String
    var organizationID: String
    var accessToken: String
    var refreshToken: String
}

private struct MessageCache {
    var revisions: [String: UInt64] = [:]
    var messages: [String: TranscriptMessage] = [:]
}

private struct DiffEnvelope: Decodable {
    struct File: Decodable { let path: String }
    let patch: String
    let files: [File]
    let additions: UInt32
    let deletions: UInt32
    let truncated: Bool
}

private final class NativeListener: ClientListener, @unchecked Sendable {
    private let callback: @Sendable (ClientEvent) -> Void
    init(_ callback: @escaping @Sendable (ClientEvent) -> Void) { self.callback = callback }
    func onEvent(event: ClientEvent) { callback(event) }
}

public enum NativeClientError: LocalizedError {
    case signedOut, sessionClosed, noHost, noOrganization, invalidAuthentication, invalidEndpoint, lockedProvider
    public var errorDescription: String? {
        switch self {
        case .signedOut: "Sign in to connect to your workspace."
        case .sessionClosed: "Open the session before sending."
        case .noHost: "Choose an available execution host."
        case .noOrganization: "This account does not belong to an organization."
        case .invalidAuthentication: "Sign-in could not be completed. Please try again."
        case .invalidEndpoint: "The connection requires a secure endpoint."
        case .lockedProvider: "An existing session must keep its agent provider."
        }
    }
}
