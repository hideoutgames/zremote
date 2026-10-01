import Foundation

public struct ClientFailure: LocalizedError, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// A separate, in-memory peer. It has no network or credential dependencies.
/// All demo actions travel through the same interface as live actions.
@MainActor public final class DemoClient: ClientService {
    public var onUpdate: (@MainActor (ClientUpdate) -> Void)?
    public let isDemo = true
    public var accountKey: String? { nil }
    private var workspace = WorkspaceState()
    private var sessions: [String: SessionState] = [:]
    private var running: [String: Task<Void, Never>] = [:]
    private var patches: [String: TurnDiff] = [:]
    private var attachmentBytes: [String: Data] = [:]
    private var projectCheckouts: [String: [ProjectCheckout]] = [:]
    private var turnStarted: [String: Date] = [:]
    private var queuedAttachments: [String: [RemoteAttachment]] = [:]
    private var queueEdits: [String: QueuedMessageEdit] = [:]
    private var pausedQueues: Set<String> = []
    private static let queueCapabilities = MessageQueueCapabilities(canQueue: true, canQueueAttachments: true, canSteer: true, canEdit: true, canAct: true)
    private let interval: UInt64
    private var active = false
    private var visibleSessionID: String?

    public init(intervalNanoseconds: UInt64 = 45_000_000) { interval = intervalNanoseconds }

    public func restore() async throws {
        active = true
        let project = Project(id: "demo-project", name: "Personal project", path: "/Users/demo/Projects/personal", hostID: "demo-mac", isRepository: true)
        projectCheckouts[project.id] = [
            ProjectCheckout(branch: "main", path: project.path, isCurrent: true),
            ProjectCheckout(branch: "demo/interface", path: "/Users/demo/Worktrees/personal/interface")
        ]
        let history = Session(id: "demo-welcome", title: "A quieter workspace", projectID: project.id, hostID: project.hostID, path: project.path, preview: "Ready when you are",
                              pullRequest: PullRequest(number: 42, title: "Sample interface changes", url: "", state: "open", provider: "Test mode", baseRef: "main", headRef: "demo/interface"), createdAt: Date().addingTimeInterval(-3600), updatedAt: Date(), lastFinishedAt: Date().addingTimeInterval(-720), completedTurnID: "demo-history-turn", providerID: "codex", modelID: "gpt-6-astra", branch: "main")
        let question = Session(id: "demo-question", title: "A quick design choice", projectID: project.id, hostID: project.hostID, path: project.path, createdAt: Date().addingTimeInterval(-7200), updatedAt: Date().addingTimeInterval(-1800), awaitingInput: true, activity: "Waiting for response", inputRequestID: "demo-input", providerID: "codex", modelID: "gpt-6-astra")
        workspace = WorkspaceState(connection: .online, hosts: [Host(id: "demo-mac", name: "Demo Mac", online: true)], projects: [project], sessions: [history, question], profile: UserProfile(id: "test-mode", displayName: "Test mode"), devices: [
            ConnectedDevice(id: "demo-mac", name: "Demo Mac", platform: "macos", online: true, isExecutionHost: true),
            ConnectedDevice(id: "demo-phone", name: "This device", platform: "ios", online: true, isExecutionHost: false, isCurrent: true)
        ])
        sessions[history.id] = SessionState(id: history.id, messages: [
            TranscriptMessage(id: "demo-message-1", role: "user", text: "Make this workspace feel a little calmer.", timestamp: Date().addingTimeInterval(-1032)),
            TranscriptMessage(id: "demo-message-2", role: "assistant", text: "Ready when you are. Start a new session, choose a model, or send a message here to try streaming and changed files. Everything in test mode stays on this device.", timestamp: Date().addingTimeInterval(-720), workedDuration: 312)
        ], selection: ModelSelection(providerID: "codex", modelID: "gpt-6-astra"), turnID: "demo-history-turn")
        patches[history.id] = Self.sampleDiff
        sessions[question.id] = SessionState(id: question.id, messages: [
            TranscriptMessage(id: "demo-question-message", role: "assistant", text: "Before I continue, which details should I focus on? You can choose several or write your own answer.", timestamp: Date().addingTimeInterval(-1800))
        ], selection: ModelSelection(providerID: "codex", modelID: "gpt-6-astra"), input: InputRequest(id: "demo-input", questions: [
            InputQuestion(id: "details", title: "What matters most?", options: ["Spacing", "Typography", "Motion"], multiple: true)
        ]))
        for id in sessions.keys { sessions[id]?.queueCapabilities = Self.queueCapabilities }
        onUpdate?(.workspace(workspace))
    }

    public func authorizationURL(state: String) throws -> URL { throw ClientFailure("Test mode does not sign in.") }
    public func exchangeCode(_ code: String) async throws -> [Organization] { throw ClientFailure("Test mode does not use credentials.") }
    public func selectOrganization(_ id: String) async throws { throw ClientFailure("Test mode does not use organizations.") }
    public func signOut() async throws {
        active = false; visibleSessionID = nil
        for task in running.values { task.cancel() }
        running.removeAll(); sessions.removeAll(); patches.removeAll(); attachmentBytes.removeAll(); projectCheckouts.removeAll()
        turnStarted.removeAll()
        queuedAttachments.removeAll(); queueEdits.removeAll(); pausedQueues.removeAll()
        workspace = WorkspaceState()
        onUpdate?(.workspace(workspace))
    }
    public func refresh() async throws { guard active else { return }; onUpdate?(.workspace(workspace)) }
    public func openSession(_ id: String) async throws {
        guard let state = sessions[id] else { throw ClientFailure("This session is no longer available.") }
        visibleSessionID = id
        if let row = workspace.sessions.firstIndex(where: { $0.id == id }) { workspace.sessions[row].unread = false }
        onUpdate?(.workspace(workspace))
        onUpdate?(.session(state))
    }
    public func closeSession(_ id: String) {
        if visibleSessionID == id { visibleSessionID = nil }
        for edit in queueEdits.values.filter({ $0.sessionID == id }) {
            queueEdits[edit.leaseID] = nil
            if let row = sessions[id]?.queue.firstIndex(where: { $0.id == edit.id }) { sessions[id]?.queue[row].deliveryBlocked = false }
        }
        drainQueue(id)
    }
    public func agentAccounts(hostID: String) async throws -> AgentAccountsSnapshot {
        guard active, hostID == "demo-mac" else { return AgentAccountsSnapshot(available: false) }
        let using = workspace.sessions.contains { $0.working }
        return AgentAccountsSnapshot(accounts: [
            AgentAccount(id: "demo-codex-account", harness: "codex", planLabel: "Test plan",
                usageWindows: [AgentUsageWindow(label: "Session limit", usedFraction: using ? 0.93 : 0.84)],
                usageFetchedAt: Int64(Date().timeIntervalSince1970 * 1000), displayName: "Demo account"),
            AgentAccount(id: "demo-claude-account", harness: "claude-code", planLabel: "Test plan",
                usageWindows: [AgentUsageWindow(label: "Weekly limit", usedFraction: 0.38)],
                usageFetchedAt: Int64(Date().timeIntervalSince1970 * 1000), displayName: "Demo account")
        ])
    }

    public func models(hostID: String) async throws -> [AgentModel] {
        DemoModelCatalog.models
    }

    public func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String {
        try await createSession(projectID: projectID, hostID: hostID, selection: selection, checkout: .current)
    }

    public func checkouts(projectID: String, hostID: String) async throws -> [ProjectCheckout] {
        guard active, let project = workspace.projects.first(where: { $0.id == projectID && $0.hostID == hostID && $0.isRepository }) else { throw ClientFailure("Choose a test repository first.") }
        return projectCheckouts[project.id] ?? [ProjectCheckout(branch: "main", path: project.path, isCurrent: true)]
    }

    public func createSession(projectID: String?, hostID: String, selection: ModelSelection, checkout: CheckoutSelection) async throws -> String {
        guard active, workspace.hosts.contains(where: { $0.id == hostID }) else { throw ClientFailure("Choose a test host first.") }
        let id = UUID().uuidString
        let project = workspace.projects.first { $0.id == projectID }
        guard projectID == nil || project?.hostID == hostID else { throw ClientFailure("The project belongs to another host.") }
        var path = project?.path ?? ""
        var branch: String? = project?.isRepository == true ? "main" : nil
        switch checkout {
        case .current: break
        case .newWorktree:
            guard let project, project.isRepository else { throw ClientFailure("A new worktree requires a test repository.") }
            let name = String(id.prefix(8)).lowercased()
            let newBranch = "zeron/" + name
            branch = newBranch
            path = "/Users/demo/Worktrees/" + project.id + "/" + name
            projectCheckouts[project.id, default: [ProjectCheckout(branch: "main", path: project.path, isCurrent: true)]].append(ProjectCheckout(branch: newBranch, path: path))
        case .existing(let selected):
            guard let project, try await checkouts(projectID: project.id, hostID: hostID).contains(selected) else { throw ClientFailure("This test checkout is no longer available.") }
            path = selected.path; branch = selected.branch
        }
        workspace.sessions.insert(Session(id: id, title: "New session", projectID: projectID, hostID: hostID, path: path, createdAt: Date(), updatedAt: Date(), providerID: selection.providerID, modelID: selection.modelID, branch: branch), at: 0)
        sessions[id] = SessionState(id: id, selection: selection, queueCapabilities: Self.queueCapabilities)
        onUpdate?(.workspace(workspace))
        return id
    }

    public func send(sessionID: String, text: String) async throws {
        try await send(sessionID: sessionID, text: text, attachments: [])
    }

    public func send(sessionID: String, text: String, attachments: [LocalAttachment]) async throws {
        try await send(sessionID: sessionID, text: text, attachments: attachments, busy: .queue)
    }

    public func send(sessionID: String, text: String, attachments: [LocalAttachment], busy: MessageSendMode) async throws {
        guard active, var state = sessions[sessionID] else { throw ClientFailure("Open a session first.") }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty || !attachments.isEmpty else { return }
        guard busy != .steer || attachments.isEmpty else { throw ClientFailure("Messages with files must wait in the queue.") }
        for attachment in attachments { try attachment.validate() }
        let remote = attachments.map { attachment -> RemoteAttachment in
            let path = "demo://" + sessionID + "/" + attachment.id
            attachmentBytes[path] = attachment.data
            return RemoteAttachment(path: path, name: attachment.name, mimeType: attachment.mimeType)
        }
        pausedQueues.remove(sessionID)
        if state.working || state.input != nil {
            if busy == .queue {
                let id = UUID().uuidString
                state.queue.append(QueuedMessage(id: id, text: clean, attachments: remote.map(\.path)))
                queuedAttachments[id] = remote
                sessions[sessionID] = state
                emit(sessionID)
                return
            }
            if state.working {
                state.messages.append(TranscriptMessage(id: UUID().uuidString, role: "user", text: clean, timestamp: Date()))
                sessions[sessionID] = state
                emit(sessionID)
                return
            }
        }
        startTurn(sessionID, text: clean, attachments: remote)
    }

    private func startTurn(_ sessionID: String, text clean: String, attachments remote: [RemoteAttachment], messageID: String = UUID().uuidString) {
        guard var state = sessions[sessionID] else { return }
        state.input = nil
        // A stopped new turn must never borrow the previous turn's file changes.
        patches[sessionID] = nil
        let userID = messageID
        let started = Date()
        turnStarted[sessionID] = started
        state.messages.append(TranscriptMessage(id: userID, role: "user", text: clean, attachments: remote, timestamp: started))
        let replyID = UUID().uuidString
        state.messages.append(TranscriptMessage(id: replyID, role: "assistant", text: "", streaming: true,
            subagents: [SubagentStatus(id: "demo-agent-" + replyID, title: "Accessibility review", status: "running", detail: "Checking spacing and accessibility in test mode.")], timestamp: started))
        state.working = true
        state.turnID = userID
        state.delivery = ""
        sessions[sessionID] = state
        if let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) {
            if workspace.sessions[index].title == "New session" {
                workspace.sessions[index].title = clean.isEmpty ? "Attachment review" : String(clean.prefix(58))
            }
            workspace.sessions[index].working = true
            workspace.sessions[index].awaitingInput = false
            workspace.sessions[index].activity = "Working"
            workspace.sessions[index].updatedAt = Date()
        }
        emit(sessionID)
        running[sessionID] = Task { [weak self] in
            let words = "I'll refine the spacing, simplify the surfaces, and keep the important actions close.\n\nThe changes are ready. Open a file below to explore the native diff viewer, or choose Show all… to see the full list. This is a simulated reply; no remote files were changed.".split(separator: " ", omittingEmptySubsequences: false)
            for (index, word) in words.enumerated() {
                guard let self, self.active, !Task.isCancelled else { return }
                if self.interval > 0 { try? await Task.sleep(nanoseconds: self.interval) }
                guard !Task.isCancelled, var current = self.sessions[sessionID], let row = current.messages.firstIndex(where: { $0.id == replyID }) else { return }
                current.messages[row].text += (index == 0 ? "" : " ") + word
                self.sessions[sessionID] = current
                self.onUpdate?(.session(current))
            }
            guard let self, !Task.isCancelled else { return }
            self.patches[sessionID] = Self.sampleDiff
            self.finish(sessionID, interrupted: false)
        }
    }

    public func readAttachment(sessionID: String, attachment: RemoteAttachment) async throws -> Data {
        guard active, attachment.path.hasPrefix("demo://" + sessionID + "/"), let data = attachmentBytes[attachment.path] else { throw ClientFailure("This test attachment is unavailable.") }
        return data
    }
    public func complete(kind: ComposerTokenKind, query: String, hostID: String, sessionID: String?, projectID: String?, providerID: String) async throws -> [ComposerCompletion] {
        guard active else { return [] }
        let candidate: ComposerCompletion
        switch kind {
        case .file: candidate = ComposerCompletion(id: "demo-file", kind: kind, title: "Sources/Composer.swift", detail: "Test mode file", insertion: "[Composer.swift](zeron-file:Sources/Composer.swift)")
        case .command, .skill:
            let name = kind == .command ? "review" : "accessibility"
            var object: [String: String] = ["kind": kind.rawValue, "name": name]
            if kind == .skill { object["path"] = "/demo/skills/accessibility/SKILL.md" }
            let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            let hex = bytes.map { String(format: "%02x", $0) }.joined()
            let prefix = kind == .command ? "/" : "$"
            candidate = ComposerCompletion(id: "demo-" + kind.rawValue, kind: kind, title: name, detail: "Test mode example", insertion: "[\(prefix)\(name)](zeron-invoke:\(hex))")
        }
        return query.isEmpty || candidate.title.localizedCaseInsensitiveContains(query) ? [candidate] : []
    }
    public func setPinned(sessionID: String, pinned: Bool) async throws {
        guard let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) else { throw ClientFailure("Session unavailable.") }
        workspace.sessions[index].pinned = pinned
        onUpdate?(.workspace(workspace))
    }
    public func renameSession(sessionID: String, title: String) async throws {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard active, !clean.isEmpty, let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) else { throw ClientFailure("This test session is no longer available.") }
        workspace.sessions[index].title = clean
        onUpdate?(.workspace(workspace))
    }
    public func setArchived(sessionID: String, archived: Bool) async throws {
        guard let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) else { throw ClientFailure("Session unavailable.") }
        workspace.sessions[index].archived = archived
        onUpdate?(.workspace(workspace))
    }

    public func interrupt(sessionID: String) async throws {
        pausedQueues.insert(sessionID)
        running[sessionID]?.cancel()
        finish(sessionID, interrupted: true)
    }

    public func retryDelivery(sessionID: String) async throws {
        guard active, sessions[sessionID] != nil else { throw ClientFailure("Open a session first.") }
    }

    public func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws {
        guard var state = sessions[sessionID], state.input?.id == requestID else { throw ClientFailure("This question is no longer waiting for an answer.") }
        state.input = nil
        if let row = workspace.sessions.firstIndex(where: { $0.id == sessionID }) {
            workspace.sessions[row].awaitingInput = false; workspace.sessions[row].activity = ""; workspace.sessions[row].inputRequestID = nil
        }
        state.messages.append(TranscriptMessage(id: UUID().uuidString, role: "assistant", text: "Your choices are saved for this demo. Send a message to try a streaming reply.", timestamp: Date()))
        sessions[sessionID] = state
        onUpdate?(.session(state))
        drainQueue(sessionID)
    }

    private func finish(_ id: String, interrupted: Bool) {
        running[id] = nil
        guard var state = sessions[id] else { return }
        let started = turnStarted.removeValue(forKey: id)
        state.working = false
        state.delivery = interrupted ? "Stopped" : ""
        if let reply = state.messages.lastIndex(where: { $0.role == "assistant" && $0.streaming }) {
            state.messages[reply].streaming = false
            state.messages[reply].workedDuration = interrupted ? nil : started.map { max(0, Date().timeIntervalSince($0)) }
            state.messages[reply].subagents = state.messages[reply].subagents.map {
                SubagentStatus(id: $0.id, title: $0.title, status: "done", detail: interrupted ? "Stopped in test mode." : "Review completed in test mode.")
            }
        }
        sessions[id] = state
        if let row = workspace.sessions.firstIndex(where: { $0.id == id }) {
            workspace.sessions[row].working = false
            workspace.sessions[row].awaitingInput = false
            workspace.sessions[row].activity = ""
            if !interrupted {
                workspace.sessions[row].lastFinishedAt = Date()
                workspace.sessions[row].completedTurnID = state.turnID
                workspace.sessions[row].unread = visibleSessionID != id
            }
            if !interrupted, workspace.sessions[row].pullRequest?.number == 42 {
                workspace.sessions[row].pullRequest = PullRequest(number: 43, title: "Sample accessibility follow-up", url: "", state: "open", provider: "Test mode", baseRef: "main", headRef: "demo/accessibility")
            }
        }
        emit(id)
        if !interrupted { drainQueue(id) }
    }

    private func drainQueue(_ sessionID: String) {
        guard active, !pausedQueues.contains(sessionID), var state = sessions[sessionID], !state.working,
              state.input == nil, let row = state.queue.first, !row.deliveryBlocked else { return }
        state.queue.removeFirst()
        sessions[sessionID] = state
        startTurn(sessionID, text: row.text, attachments: queuedAttachments.removeValue(forKey: row.id) ?? [], messageID: row.id)
    }

    public func sendQueuedNow(sessionID: String, id: String) async throws {
        guard active, var state = sessions[sessionID], let index = state.queue.firstIndex(where: { $0.id == id }) else { throw ClientFailure("This message has already left the queue.") }
        let row = state.queue[index]
        guard row.attachments.isEmpty else { throw ClientFailure("Messages with files wait for the turn to finish.") }
        guard !row.deliveryBlocked else { throw ClientFailure("This message is being edited.") }
        state.queue.remove(at: index)
        queuedAttachments[id] = nil
        pausedQueues.remove(sessionID)
        if state.working {
            state.messages.append(TranscriptMessage(id: id, role: "user", text: row.text, timestamp: Date()))
            sessions[sessionID] = state
            emit(sessionID)
        } else {
            sessions[sessionID] = state
            startTurn(sessionID, text: row.text, attachments: [], messageID: id)
        }
    }

    public func moveQueuedMessage(sessionID: String, id: String, delta: Int) async throws {
        guard active, var state = sessions[sessionID], let index = state.queue.firstIndex(where: { $0.id == id }) else { throw ClientFailure("This message has already left the queue.") }
        guard !state.queue[index].deliveryBlocked, !state.queue[index].actionPending else { throw ClientFailure("This queued message is currently being edited or sent.") }
        let (destination, overflow) = index.addingReportingOverflow(delta)
        guard !overflow, delta != 0, destination >= 0, destination < state.queue.count else { throw ClientFailure("This message could not be moved. Check the queue and try again.") }
        let row = state.queue.remove(at: index)
        state.queue.insert(row, at: destination)
        sessions[sessionID] = state
        emit(sessionID)
    }

    public func deleteQueuedMessage(sessionID: String, id: String) async throws {
        guard active, var state = sessions[sessionID], let index = state.queue.firstIndex(where: { $0.id == id }) else { throw ClientFailure("This message has already left the queue.") }
        state.queue.remove(at: index)
        queuedAttachments[id] = nil
        sessions[sessionID] = state
        emit(sessionID)
        drainQueue(sessionID)
    }

    public func beginQueuedMessageEdit(sessionID: String, id: String) async throws -> QueuedMessageEdit {
        guard active, var state = sessions[sessionID], let index = state.queue.firstIndex(where: { $0.id == id }) else { throw ClientFailure("This message has already left the queue.") }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        guard !queueEdits.values.contains(where: { $0.sessionID == sessionID && $0.id == id && $0.expiresAtMilliseconds > now }) else { throw ClientFailure("This message is already being edited.") }
        let row = state.queue[index]
        let edit = QueuedMessageEdit(id: id, sessionID: sessionID, leaseID: UUID().uuidString, text: row.text,
            baseTextHash: UUID().uuidString, expiresAtMilliseconds: now + 60_000, hasAttachments: !row.attachments.isEmpty)
        queueEdits[edit.leaseID] = edit
        state.queue[index].deliveryBlocked = true
        sessions[sessionID] = state
        emit(sessionID)
        return edit
    }

    public func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async throws -> Bool {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        guard active, var saved = queueEdits[edit.leaseID], saved.expiresAtMilliseconds > now,
              sessions[edit.sessionID]?.queue.contains(where: { $0.id == edit.id }) == true else { return false }
        saved.expiresAtMilliseconds = now + 60_000
        queueEdits[edit.leaseID] = saved
        return true
    }

    public func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async throws {
        guard active, let saved = queueEdits[edit.leaseID], saved.sessionID == edit.sessionID,
              saved.expiresAtMilliseconds > Int64(Date().timeIntervalSince1970 * 1000),
              var state = sessions[edit.sessionID], let index = state.queue.firstIndex(where: { $0.id == edit.id }) else { throw ClientFailure("This edit is no longer active. Reopen the queued message.") }
        guard state.queue[index].text == saved.text else { throw ClientFailure("This message changed. Copy your edit and reopen it.") }
        if let text {
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !state.queue[index].attachments.isEmpty else { throw ClientFailure("Enter a message, or use Delete to remove it.") }
            state.queue[index].text = text
        }
        state.queue[index].deliveryBlocked = false
        queueEdits[edit.leaseID] = nil
        sessions[edit.sessionID] = state
        emit(edit.sessionID)
        drainQueue(edit.sessionID)
    }

    private func emit(_ id: String) {
        onUpdate?(.workspace(workspace))
        if let state = sessions[id] { onUpdate?(.session(state)) }
    }

    public func setModel(sessionID: String, selection: ModelSelection) async throws {
        guard var state = sessions[sessionID] else { throw ClientFailure("Session unavailable.") }
        guard state.selection.providerID == selection.providerID else { throw ClientFailure("A session keeps its original provider.") }
        state.selection = selection
        sessions[sessionID] = state
        onUpdate?(.session(state))
    }

    public func listFolders(hostID: String, path: String?) async throws -> FolderPage {
        let base = path ?? "/Users/demo"
        let folders = base == "/Users/demo" ? [RemoteFolder(name: "Projects", path: base + "/Projects"), RemoteFolder(name: "Desktop", path: base + "/Desktop")] : [RemoteFolder(name: "personal", path: base + "/personal", isRepository: true)]
        let parent = base == "/Users/demo" ? nil : String(base.prefix(upTo: base.lastIndex(of: "/")!))
        return FolderPage(path: base, parent: parent, folders: folders)
    }
    public func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String {
        let id = UUID().uuidString
        workspace.projects.append(Project(id: id, name: path.split(separator: "/").last.map(String.init) ?? "Project", path: path, hostID: hostID, isRepository: isRepository))
        onUpdate?(.workspace(workspace))
        return id
    }
    public func createRepository(hostID: String, name: String) async throws -> String {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ClientFailure("Give the project a name.") }
        return try await addProject(hostID: hostID, path: "/Users/demo/.zeron/repos/" + name, isRepository: true)
    }
    public func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff {
        guard sessions[sessionID]?.turnID == turnID, sessions[sessionID]?.working == false else { throw ClientFailure("This turn is no longer available.") }
        guard let diff = patches[sessionID] else { throw ClientFailure("No file changes are available for this turn.") }
        return diff
    }
    public func setForeground(_ foreground: Bool) {}

    public static var sampleDiff: TurnDiff {
        let paths = ["Sources/Composer.swift", "Sources/SessionList.swift", "Sources/Palette.swift", "Sources/ModelPicker.swift", "Sources/ProjectPicker.swift", "Sources/Changes.swift", "README.md"]
        let patch = paths.map { path in
            "diff --git a/\(path) b/\(path)\n--- a/\(path)\n+++ b/\(path)\n@@ -1,3 +1,4 @@\n // A calmer workspace\n-let spacing = 8\n+let spacing = 12\n+let respectsReducedMotion = true\n // Native on both platforms\n"
        }.joined()
        return TurnDiff(patch: patch, paths: paths, additions: 14, deletions: 7)
    }
}
