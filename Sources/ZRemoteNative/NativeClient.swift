import Foundation
import SkipKeychain
import ZRemoteCore

/// One account-scoped, engine-free peer. Rust owns sync, durable delivery and
/// host RPC; this adapter owns secure credentials and presentation projections.
@MainActor public final class NativeClient: ClientService {
    public var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    public let isDemo = false
    public var accountKey: String? { account.map { $0.userID + "/" + $0.organizationID } }
    public var zeronAccounts: [ZeronAccount] {
        accounts.map { stored in
            ZeronAccount(id: stored.id, profile: stored.profile ?? UserProfile(id: stored.userID, displayName: "Your account"),
                         organizationID: stored.organizationID, active: stored.id == account?.id)
        }
    }

    private let edgeURL: String
    private var client: CoreClient?
    private var account: StoredAccount?
    private var accounts: [StoredAccount] = []
    private var pendingAuth: AuthExchange?
    private var pendingOrganizations: [AuthOrg] = []
    private var generation = UUID()
    private var handles: [String: SessionHandle] = [:]
    private var queueEdits: [String: (sessionID: String, handle: SessionHandle, lease: QueueEditLease)] = [:]
    private var pendingQueueEdits: Set<String> = []
    private var pendingWorktrees: [String: PendingWorktreeIntent] = [:]
    private var recoveredWorktrees: Set<String> = []
    private var worktreeStore: PendingWorktreeStore?
    private var projections: [String: MessageCache] = [:]
    private var transcriptMetadata: [String: TranscriptMetadata.Cache] = [:]
    private var listener: NativeListener?
    private var refreshTask: Task<Void, Never>?
    private var dirtySessions: Set<String> = []
    private var workspaceDirty = false
    private var lastFinished: [String: Date] = [:]
    private var lastCompleted: [String: String] = [:]
    private var observedSessionIDs: Set<String> = []
    private var observedRunningSessionIDs: Set<String> = []
    private var inputIdentities: [String: InputNotificationIdentity] = [:]

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
        let data = Data(value.utf8)
        let stored: StoredAccount
        if let envelope = try? JSONDecoder().decode(StoredAccounts.self, from: data) {
            accounts = envelope.accounts
            guard let selected = accounts.first(where: { $0.id == envelope.activeID }) ?? accounts.first else {
                onUpdate?(.workspace(.init()))
                return
            }
            stored = selected
        } else {
            stored = try JSONDecoder().decode(StoredAccount.self, from: data)
            accounts = [stored]
            try persist(activeID: stored.id)
        }
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
        let result: AuthExchange
        do { result = try await authExchangeCode(edgeUrl: edgeURL, code: code) }
        catch { throw ClientFailure("The login code couldn't be exchanged. Start sign-in again; login codes can only be used once.") }
        let organizations: [AuthOrg]
        do { organizations = try await authListOrgs(edgeUrl: edgeURL, accessToken: result.tokens.accessToken) }
        catch { throw ClientFailure("Login succeeded, but your organizations couldn't be loaded. Check your connection and try again.") }
        guard generation == operation else { throw CancellationError() }
        guard !organizations.isEmpty else { throw ClientFailure("This account does not belong to an organization.") }
        pendingAuth = result
        pendingOrganizations = organizations
        return organizations.map { Organization(id: $0.organizationId, name: $0.name) }
    }

    public func selectOrganization(_ id: String) async throws {
        let operation = generation
        guard let pendingAuth, pendingOrganizations.contains(where: { $0.organizationId == id }) else {
            throw NativeClientError.invalidAuthentication
        }
        let tokens: AuthTokens
        do { tokens = try await authRefresh(edgeUrl: edgeURL, refreshToken: pendingAuth.tokens.refreshToken, organizationId: id) }
        catch { throw ClientFailure("Your organization couldn't be authorized. Start sign-in again.") }
        guard generation == operation else { throw CancellationError() }
        let user = pendingAuth.user
        let name = [user.firstName, user.lastName].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        let photo = user.profilePictureUrl.flatMap { value -> String? in
            guard let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil else { return nil }
            return value
        }
        let stored = StoredAccount(userID: user.id, organizationID: id, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
            profile: UserProfile(id: user.id, displayName: name.isEmpty ? (user.email ?? "Your account") : name,
                                 email: user.email, avatarURL: photo))
        let previous = account
        try save(stored)
        self.pendingAuth = nil
        pendingOrganizations = []
        do { try await start(stored) }
        catch {
            if let previous {
                try? persist(activeID: previous.id)
                try? await start(previous)
            }
            throw error
        }
    }

    public func signOut() async throws {
        let previous = account
        generation = UUID()
        let operation = generation
        let edits = Array(queueEdits.values)
        queueEdits.removeAll()
        for edit in edits {
            _ = await edit.handle.finishQueuedEdit(lease: edit.lease, action: .cancel, text: nil)
        }
        try ensureCurrent(operation)
        shutdown()
        if let previous { accounts.removeAll { $0.id == previous.id } }
        if let next = accounts.first { try persist(activeID: next.id) }
        else { try Keychain.shared.removeValue(forKey: Self.credentialKey) }
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

    public func switchAccount(_ id: String) async throws {
        guard let stored = accounts.first(where: { $0.id == id }) else { throw NativeClientError.invalidAuthentication }
        guard let previous = account, stored.id != previous.id else { return }
        try persist(activeID: stored.id)
        do { try await start(stored) }
        catch {
            try? persist(activeID: previous.id)
            try? await start(previous)
            throw error
        }
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
        let edits = queueEdits.filter { $0.value.sessionID == id }
        for (key, edit) in edits {
            queueEdits[key] = nil
            Task { _ = await edit.handle.finishQueuedEdit(lease: edit.lease, action: .cancel, text: nil) }
        }
        handles.removeValue(forKey: id)?.setViewAttached(attached: false)
        projections[id] = nil
        transcriptMetadata[id] = nil
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
                    }, defaultEffort: model.defaultReasoning)
            }
        }
        return result
    }

    public func agentAccounts(hostID: String) async throws -> AgentAccountsSnapshot {
        let operation = generation
        let core = try requireClient()
        guard core.executionDevices().contains(where: { $0.id == hostID }) else { throw NativeClientError.noHost }
        let json = try await core.agentAccountsJson(deviceId: hostID)
        try ensureCurrent(operation)
        guard json.utf8.count <= 1_000_000 else { throw ClientFailure("The host account response is too large.") }
        let decoded = try JSONDecoder().decode(AccountsEnvelope.self, from: Data(json.utf8))
        return AgentAccountsSnapshot(accounts: decoded.accounts, warnings: decoded.warnings)
    }

    public func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String {
        try await createSession(projectID: projectID, hostID: hostID, selection: selection, checkout: .current)
    }

    public func checkouts(projectID: String, hostID: String) async throws -> [ProjectCheckout] {
        let operation = generation
        let core = try requireClient()
        guard core.executionDevices().contains(where: { $0.id == hostID }) else { throw NativeClientError.noHost }
        guard let project = core.project(spaceId: projectID), project.deviceId == hostID, project.gitDetected else {
            throw ClientFailure("Choose a repository on this host first.")
        }
        let refs = try await core.listRefs(deviceId: hostID, repoPath: project.path)
        try ensureCurrent(operation)
        guard let current = core.project(spaceId: projectID), current.path == project.path, current.deviceId == hostID, current.gitDetected else { throw CancellationError() }
        var paths: Set<String> = []
        var values = refs.compactMap { ref -> ProjectCheckout? in
            guard let path = ref.current ? project.path : ref.worktreePath, !path.isEmpty, paths.insert(path).inserted else { return nil }
            return ProjectCheckout(branch: ref.name, path: path, isCurrent: ref.current)
        }
        // A detached HEAD has no current branch ref, but the project folder is
        // still a valid existing checkout. Do not invent a branch name for it.
        if !values.contains(where: \.isCurrent) {
            if let index = values.firstIndex(where: { $0.path == project.path }) { values[index].isCurrent = true }
            else { values.insert(ProjectCheckout(branch: "", path: project.path, isCurrent: true), at: 0) }
        }
        return values.sorted { left, right in
            if left.isCurrent != right.isCurrent { return left.isCurrent }
            return left.branch.localizedStandardCompare(right.branch) == .orderedAscending
        }
    }

    public func createSession(projectID: String?, hostID: String, selection: ModelSelection, checkout: CheckoutSelection) async throws -> String {
        let operation = generation
        let core = try requireClient()
        guard core.executionDevices().contains(where: { $0.id == hostID }) else { throw NativeClientError.noHost }
        let project = projectID.flatMap { core.project(spaceId: $0) }
        if projectID != nil, project?.deviceId != hostID { throw NativeClientError.noHost }
        var branch: String?
        var cwd: String?
        var worktree: PendingWorktreeIntent?
        switch checkout {
        case .current: break
        case .newWorktree:
            guard let project, project.gitDetected else { throw ClientFailure("A new worktree requires a repository.") }
            worktree = PendingWorktreeIntent(projectID: project.id, repoPath: project.path)
        case .existing(let chosen):
            guard let project else { throw ClientFailure("Choose a project before its checkout.") }
            let available = try await checkouts(projectID: project.id, hostID: hostID)
            try ensureCurrent(operation)
            guard available.contains(chosen) else { throw ClientFailure("This checkout changed. Choose it again before sending.") }
            branch = chosen.branch.isEmpty ? nil : chosen.branch
            cwd = chosen.path
        }
        try ensureCurrent(operation)
        let target: SessionTarget = projectID.map { .project(spaceId: $0) } ?? .projectless(deviceId: hostID)
        let id = try core.createSession(newSession: NewSession(target: target, config: config(selection), branch: branch, cwd: cwd, title: nil))
        if let worktree {
            pendingWorktrees[id] = worktree
            do {
                guard let worktreeStore else { throw NativeClientError.signedOut }
                try worktreeStore.save(pendingWorktrees)
            } catch {
                pendingWorktrees[id] = nil
                // No host work has begun. Roll back only the empty row created
                // in this transaction; the original composer retains its draft.
                try? core.deleteSession(chatId: id)
                throw ClientFailure("Couldn't save the new worktree destination. Your message was not sent.")
            }
        }
        try await openSession(id)
        try ensureCurrent(operation)
        publishWorkspace(core)
        return id
    }

    public func send(sessionID: String, text: String) async throws {
        try await send(sessionID: sessionID, text: text, attachments: [])
    }

    public func send(sessionID: String, text: String, attachments: [LocalAttachment]) async throws {
        try await send(sessionID: sessionID, text: text, attachments: attachments, busy: .queue)
    }

    public func send(sessionID: String, text: String, attachments: [LocalAttachment], busy: MessageSendMode) async throws {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty else { return }
        for attachment in attachments { try attachment.validate() }
        let handle = try requireHandle(sessionID)
        if busy == .steer {
            guard attachments.isEmpty else { throw ClientFailure("Messages with files must wait in the queue.") }
            guard handle.composer().host.capabilities.midTurnSteering == true else { throw ClientFailure("This agent cannot steer during a turn. Choose Queue.") }
        }
        var worktree: WorktreeSpec?
        if let intent = pendingWorktrees[sessionID] {
            let status = handle.transcriptStatus()
            if status.entryCount > 0 || status.pendingCount > 0 || !handle.composer().pendingSends.isEmpty {
                // A previous enqueue survived even if removing the intent file
                // did not. Its durable Run already contains the worktree spec.
                pendingWorktrees[sessionID] = nil
                recoveredWorktrees.remove(sessionID)
                try? worktreeStore?.save(pendingWorktrees)
            } else {
                guard !recoveredWorktrees.contains(sessionID) || status.hydrated else {
                    throw ClientFailure("Wait for this session to finish syncing before retrying its first message.")
                }
                worktree = WorktreeSpec(repoPath: intent.repoPath, base: intent.base, spaceId: intent.projectID)
            }
        }
        _ = try handle.send(request: SendRequest(text: text, attachments: attachments.map {
            OutgoingAttachment(name: $0.name, mimeType: $0.mimeType, data: $0.data)
        }, worktree: worktree, busy: busy == .steer ? .steer : .queue))
        // The run command now durably owns creation of the isolated checkout.
        // Retain the choice after a thrown send so a retry keeps its destination.
        if pendingWorktrees.removeValue(forKey: sessionID) != nil {
            recoveredWorktrees.remove(sessionID)
            try? worktreeStore?.save(pendingWorktrees)
        }
        publishSession(sessionID)
    }

    public func sendQueuedNow(sessionID: String, id: String) async throws {
        let operation = generation
        let handle = try requireHandle(sessionID)
        let composer = handle.composer()
        guard composer.host.capabilities.queueActions, composer.host.capabilities.midTurnSteering == true else { throw ClientFailure("This host cannot steer queued messages.") }
        guard let row = composer.queue.first(where: { $0.id == id }) else { throw ClientFailure("This message has already left the queue.") }
        guard row.attachments.isEmpty else { throw ClientFailure("Messages with files wait for the turn to finish.") }
        guard row.gate == nil, !row.actionPending else { throw ClientFailure("This queued message is currently being edited or sent.") }
        guard try await handle.deliverQueuedNow(id: id) else { throw ClientFailure("The host did not confirm this message. Check the queue before retrying.") }
        try ensureCurrent(operation)
        publishSession(sessionID)
    }

    public func moveQueuedMessage(sessionID: String, id: String, delta: Int) async throws {
        let handle = try requireHandle(sessionID)
        guard handle.composer().host.capabilities.messageQueue else { throw ClientFailure("This host does not support a message queue.") }
        guard handle.composer().queue.contains(where: { $0.id == id && !$0.actionPending && $0.gate == nil }) else { throw ClientFailure("This queued message is currently being edited, sent, or is no longer available.") }
        guard try handle.moveQueuedBy(id: id, delta: Int32(clamping: delta)) else { throw ClientFailure("This message could not be moved. Check the queue and try again.") }
        publishSession(sessionID)
    }

    public func deleteQueuedMessage(sessionID: String, id: String) async throws {
        let operation = generation
        let handle = try requireHandle(sessionID)
        guard handle.composer().host.capabilities.queueActions else { throw ClientFailure("This host does not support queue actions.") }
        guard try await handle.removeQueued(id: id) else { throw ClientFailure("The host did not confirm removal. Check the queue before retrying.") }
        try ensureCurrent(operation)
        publishSession(sessionID)
    }

    public func beginQueuedMessageEdit(sessionID: String, id: String) async throws -> QueuedMessageEdit {
        let operation = generation
        let handle = try requireHandle(sessionID)
        guard handle.composer().host.capabilities.queueEditLease else { throw ClientFailure("Update the chat host to edit queued messages safely.") }
        let key = sessionID + "\u{1F}" + id
        guard pendingQueueEdits.insert(key).inserted else { throw ClientFailure("This message is already opening for editing.") }
        defer { pendingQueueEdits.remove(key) }
        let result = await handle.beginQueuedEdit(id: id, instanceId: UUID().uuidString)
        if case .acquired(let lease) = result {
            guard operation == generation, handles[sessionID] === handle else {
                _ = await handle.finishQueuedEdit(lease: lease, action: .cancel, text: nil)
                throw NativeClientError.sessionClosed
            }
            queueEdits[lease.leaseId] = (sessionID, handle, lease)
            publishSession(sessionID)
            return QueuedMessageEdit(id: id, sessionID: sessionID, leaseID: lease.leaseId, text: lease.text,
                baseTextHash: lease.baseTextHash, expiresAtMilliseconds: lease.expiresAtMs,
                hasAttachments: handle.composer().queue.first(where: { $0.id == id }).map { !$0.attachments.isEmpty } ?? false)
        }
        try ensureCurrent(operation)
        switch result {
        case .locked: throw ClientFailure("This message is being edited on another device.")
        case .missing: throw ClientFailure("This message has already left the queue.")
        default: throw ClientFailure("Couldn't open this message for editing. Check the host connection.")
        }
    }

    public func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async throws -> Bool {
        let operation = generation
        guard let current = queueEdits[edit.leaseID], current.sessionID == edit.sessionID,
              current.lease.rowId == edit.id, handles[edit.sessionID] === current.handle else { return false }
        let renewed = await current.handle.renewQueuedEdit(lease: current.lease)
        try ensureCurrent(operation)
        return renewed
    }

    public func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async throws {
        let operation = generation
        guard let current = queueEdits[edit.leaseID], current.sessionID == edit.sessionID,
              current.lease.rowId == edit.id, handles[edit.sessionID] === current.handle else { throw ClientFailure("This edit is no longer active. Reopen the queued message.") }
        if let text, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !edit.hasAttachments {
            throw ClientFailure("Enter a message, or use Delete to remove it.")
        }
        let result = await current.handle.finishQueuedEdit(lease: current.lease, action: text == nil ? .cancel : .commit, text: text)
        try ensureCurrent(operation)
        switch result {
        case .finished:
            queueEdits[edit.leaseID] = nil
            publishSession(edit.sessionID)
        case .missing: throw ClientFailure("This message has already left the queue. Your edit was not saved.")
        case .conflict: throw ClientFailure("This message changed on another device. Copy your edit and reopen it.")
        case .lost: throw ClientFailure("This edit expired. Copy your edit and reopen the queued message.")
        case .unavailable: throw ClientFailure("Couldn't save this edit. Check the host connection and try again.")
        }
    }

    public func readAttachment(sessionID: String, attachment: RemoteAttachment) async throws -> Data {
        let operation = generation
        let core = try requireClient()
        guard let row = core.sessionRow(chatId: sessionID),
              projections[sessionID]?.messages.values.contains(where: { $0.attachments.contains(where: { $0.path == attachment.path }) }) == true else {
            throw ClientFailure("This attachment is no longer available in the open session.")
        }
        let bytes = try await core.readAttachment(deviceId: row.deviceId, path: attachment.path)
        try ensureCurrent(operation)
        return bytes
    }

    public func complete(kind: ComposerTokenKind, query: String, hostID: String, sessionID: String?, projectID: String?, providerID: String) async throws -> [ComposerCompletion] {
        let operation = generation
        let core = try requireClient()
        if kind == .file {
            let files = try await core.searchFiles(deviceId: hostID, chatId: sessionID, spaceId: sessionID == nil ? projectID : nil, query: query)
            try ensureCurrent(operation)
            return files.filter { !$0.path.replacingOccurrences(of: "\\", with: "/").split(separator: "/").contains(where: { $0.lowercased() == ".git" }) }.prefix(60).map {
                ComposerCompletion(id: "file:" + $0.path, kind: .file, title: $0.path, detail: $0.isDir ? "Folder" : "File",
                    insertion: fileMentionLink(path: $0.path, isDir: $0.isDir))
            }
        }
        let json = try await core.composerCompletionsJson(deviceId: hostID, chatId: sessionID, spaceId: sessionID == nil ? projectID : nil,
            harness: providerID, kind: kind.rawValue, query: query)
        try ensureCurrent(operation)
        return try JSONDecoder().decode([ComposerCompletion].self, from: Data(json.utf8))
    }

    public func setPinned(sessionID: String, pinned: Bool) async throws {
        let core = try requireClient()
        if pinned { try core.pinSession(chatId: sessionID) } else { try core.unpinSession(chatId: sessionID) }
        publishWorkspace(core)
    }
    public func renameSession(sessionID: String, title: String) async throws {
        let core = try requireClient()
        guard core.sessionRow(chatId: sessionID) != nil else { throw ClientFailure("This session is no longer available.") }
        try core.renameSession(chatId: sessionID, title: title)
        publishWorkspace(core)
    }
    public func setArchived(sessionID: String, archived: Bool) async throws {
        let core = try requireClient()
        if archived { try core.archiveSession(chatId: sessionID) } else { try core.unarchiveSession(chatId: sessionID) }
        publishWorkspace(core)
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
        let intentStore = PendingWorktreeStore(directory: directory)
        pendingWorktrees = try intentStore.load()
        recoveredWorktrees = Set(pendingWorktrees.keys)
        worktreeStore = intentStore
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
        queueEdits.removeAll(); pendingQueueEdits.removeAll()
        pendingWorktrees.removeAll()
        recoveredWorktrees.removeAll(); worktreeStore = nil
        projections.removeAll()
        transcriptMetadata.removeAll()
        lastFinished.removeAll(); lastCompleted.removeAll(); observedSessionIDs.removeAll(); observedRunningSessionIDs.removeAll(); inputIdentities.removeAll()
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
        case .sessionChanged(let id, _):
            dirtySessions.insert(id)
        case .composerChanged(let id, _):
            dirtySessions.insert(id)
            workspaceDirty = true
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
        let (signalRows, metadataChanged) = readSessionSignals(core)
        let signals = Dictionary(uniqueKeysWithValues: signalRows.map { ($0.sessionID, $0) })
        let ordered = snapshot.front.pinned + snapshot.front.sections.flatMap(\.sessions) + snapshot.front.recent + snapshot.archived
        var seen: Set<String> = []
        let sessions = ordered.filter { seen.insert($0.id).inserted }.map { row in
            let signal = signals[row.id]
            if row.hostIndicator == .working || row.hostIndicator == .awaitingInput { observedRunningSessionIDs.insert(row.id) }
            if let signal, let updatedAt = signal.updatedAtMs, let failed = signal.failed {
                if let turn = signal.completedTurnID, !failed, observedSessionIDs.contains(row.id), lastCompleted[row.id] != turn,
                   lastCompleted[row.id] != nil || observedRunningSessionIDs.contains(row.id) {
                    // Only a host-written successful completion advances this.
                    lastFinished[row.id] = Date(timeIntervalSince1970: Double(updatedAt) / 1000)
                    if row.hostIndicator != .working && row.hostIndicator != .awaitingInput { observedRunningSessionIDs.remove(row.id) }
                }
                if failed { observedRunningSessionIDs.remove(row.id) }
                lastCompleted[row.id] = signal.completedTurnID
                observedSessionIDs.insert(row.id)
            }
            var inputIdentity = inputIdentities[row.id] ?? InputNotificationIdentity()
            let inputID = inputIdentity.resolve(awaitingInput: row.indicator == .awaitingInput,
                requestID: core.session(chatId: row.id)?.composer().openInput?.requestId, updatedAtMs: signal?.updatedAtMs)
            inputIdentities[row.id] = inputIdentity
            let request = row.pullRequest.map { pr in
                ZRemoteCore.PullRequest(number: pr.number, title: pr.title, url: pr.url,
                    state: pr.state == .open ? "open" : pr.state == .merged ? "merged" : "closed",
                    provider: pr.provider, baseRef: pr.baseRef, headRef: pr.headRef)
            }
            return Session(id: row.id, title: row.title, projectID: row.project?.id, hostID: row.deviceId,
                path: row.cwd ?? "", preview: row.preview ?? "", working: row.indicator == .working,
                unread: row.unseen, pullRequest: request, pinned: row.pinned, archived: row.archived,
                createdAt: Date(timeIntervalSince1970: Double(row.createdAtMs) / 1000), updatedAt: Date(timeIntervalSince1970: Double(row.lastActivityMs) / 1000),
                awaitingInput: row.indicator == .awaitingInput, failed: signal?.failed == true || row.indicator == .errored || row.sendState == .failed,
                activity: row.indicator == .awaitingInput ? "Waiting for response" : row.indicator == .working ? "Working" : "",
                lastFinishedAt: lastFinished[row.id], completedTurnID: signal?.completedTurnID ?? lastCompleted[row.id],
                inputRequestID: inputID, providerID: row.harness ?? "", modelID: row.model, branch: row.branch)
        }
        let connection: ClientConnection
        switch core.connectivity().state {
        case .connected: connection = .online
        case .offline: connection = .offline
        case .reconnecting, .disabled: connection = .connecting
        }
        onUpdate?(.workspace(WorkspaceState(connection: connection,
            hosts: snapshot.devices.filter(\.isExecutionHost).map { Host(id: $0.id, name: $0.name, online: $0.online) },
            projects: snapshot.projects.map { Project(id: $0.id, name: $0.name, path: $0.path, hostID: $0.deviceId, isRepository: $0.gitDetected) }, sessions: sessions,
            profile: account?.profile ?? account.map { UserProfile(id: $0.userID, displayName: "Your account") },
            devices: snapshot.devices.map { ConnectedDevice(id: $0.id, name: $0.name, platform: $0.platform,
                online: $0.online, isExecutionHost: $0.isExecutionHost, isCurrent: $0.isSelf) })))
        // Metadata-only deltas can accompany a workspace event without any text
        // revision. Republish those open transcripts after consuming every delta.
        for id in metadataChanged { publishSession(id, refreshMetadata: false) }
    }

    private func readSessionSignals(_ core: CoreClient) -> ([SessionSignal], [String]) {
        guard let json = try? core.sessionSignalsJson() else { return ([], []) }
        var changed: [String] = []
        if let updates = try? TranscriptMetadata.decode(json) {
            for (id, update) in updates where handles[id] != nil {
                var cache = transcriptMetadata[id] ?? TranscriptMetadata.Cache()
                let previous = cache
                cache.apply(update)
                transcriptMetadata[id] = cache
                if cache != previous { changed.append(id) }
            }
        }
        return ((try? JSONDecoder().decode([SessionSignal].self, from: Data(json.utf8))) ?? [], changed)
    }

    private func publishSession(_ id: String, refreshMetadata: Bool = true) {
        guard let handle = handles[id], let core = client else { return }
        var cache = projections[id] ?? MessageCache()
        let update = handle.transcriptUpdate(known: cache.revisions)
        let needsMetadata = transcriptMetadata[id] == nil || update.changed.contains { row in
            row.role == "user" || !row.streaming || cache.messages[row.id] == nil
                || row.subagents.map(\.id) != (cache.messages[row.id]?.subagents.map(\.id) ?? [])
        }
        let otherMetadataChanges = refreshMetadata && needsMetadata ? readSessionSignals(core).1 : []
        for row in update.changed {
            cache.revisions[row.id] = row.revision
            cache.messages[row.id] = TranscriptMessage(id: row.id, role: row.role, text: row.text, streaming: row.streaming,
                attachments: row.attachments.map { RemoteAttachment(path: $0.path, name: $0.name, mimeType: $0.mimeType) },
                subagents: row.subagents.map { ZRemoteCore.SubagentStatus(id: $0.id, status: $0.status, detail: $0.tail) },
                parts: row.parts.map { part in
                    TranscriptPart(id: part.id, kind: part.kind, text: part.text, tool: part.tool.map { tool in
                        TranscriptTool(kind: tool.kind, label: tool.label, detail: tool.detail, path: tool.path,
                            invocation: tool.invocation, output: tool.output, outputKind: tool.outputKind,
                            resolved: tool.resolved, failed: tool.failed, truncated: tool.truncated)
                    }, truncated: part.truncated)
                })
        }
        let present = Set(update.orderedIds)
        cache.revisions = cache.revisions.filter { present.contains($0.key) }
        cache.messages = cache.messages.filter { present.contains($0.key) }
        // Metadata's explicit removedIDs/reset deltas own its retention. A
        // concurrently newer metadata row must survive this transcript order.
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
        let visibleMessages = TranscriptMetadata.applying(transcriptMetadata[id] ?? .init(),
            to: update.orderedIds.compactMap { cache.messages[$0] }, latestTurnRunning: composer.live.turnRunning)
        onUpdate?(.session(SessionState(id: id, messages: visibleMessages,
            selection: ModelSelection(providerID: config?.harness ?? "claude-code", modelID: config?.model,
                effort: config?.reasoning, options: config?.modelOptions ?? [:]),
            working: composer.live.turnRunning, delivery: delivery, deliveryFailed: composer.sendState == .failed,
              turnID: update.turnId, input: input,
              queue: composer.queue.map { QueuedMessage(id: $0.id, text: $0.visibleText, attachments: $0.attachments,
                  holdForTurnEnd: $0.holdForTurnEnd, deliveryBlocked: $0.gate != nil, actionPending: $0.actionPending) },
              queueCapabilities: MessageQueueCapabilities(canQueue: composer.host.capabilities.messageQueue,
                  canQueueAttachments: composer.host.capabilities.messageQueue && composer.host.capabilities.queueAttachments && composer.host.capabilities.queuedAttachments,
                  canSteer: composer.host.capabilities.midTurnSteering == true,
                  canEdit: composer.host.capabilities.queueEditLease, canAct: composer.host.capabilities.queueActions),
              queueError: composer.queueError,
              workingStartedAt: handle.transcriptStatus().workingSinceMs.flatMap { milliseconds in
                  milliseconds > 0 && milliseconds <= 253_402_300_799_999
                    ? Date(timeIntervalSince1970: Double(milliseconds) / 1000) : nil
              })))
        for changedID in otherMetadataChanges where changedID != id { publishSession(changedID, refreshMetadata: false) }
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
        if let index = accounts.firstIndex(where: { $0.id == stored.id }) { accounts[index] = stored }
        else { accounts.append(stored) }
        try persist(activeID: stored.id)
    }

    private func persist(activeID: String) throws {
        let data = try JSONEncoder().encode(StoredAccounts(activeID: activeID, accounts: accounts))
        guard let value = String(data: data, encoding: .utf8) else { throw NativeClientError.invalidAuthentication }
        try Keychain.shared.set(value, forKey: Self.credentialKey, access: .unlockedThisDeviceOnly)
    }
}

private struct StoredAccount: Codable {
    var userID: String
    var organizationID: String
    var accessToken: String
    var refreshToken: String
    var profile: UserProfile?
    var id: String { userID + "/" + organizationID }
}

private struct StoredAccounts: Codable {
    var activeID: String
    var accounts: [StoredAccount]
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

private struct AccountsEnvelope: Decodable {
    var accounts: [AgentAccount]
    var warnings: [AgentAccountWarning]
}

private struct SessionSignal: Decodable {
    var sessionID: String
    var completedTurnID: String?
    var updatedAtMs: Int64?
    var failed: Bool?
}
