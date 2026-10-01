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
    private let interval: UInt64
    private var active = false
    private var visibleSessionID: String?

    public init(intervalNanoseconds: UInt64 = 45_000_000) { interval = intervalNanoseconds }

    public func restore() async throws {
        active = true
        let project = Project(id: "demo-project", name: "Personal project", path: "/Users/demo/Projects/personal", hostID: "demo-mac")
        let history = Session(id: "demo-welcome", title: "A quieter workspace", projectID: project.id, hostID: project.hostID, path: project.path, preview: "Ready when you are",
                              pullRequest: PullRequest(number: 42, title: "Sample interface changes", url: "", state: "open", provider: "Test mode", baseRef: "main", headRef: "demo/interface"), createdAt: Date().addingTimeInterval(-3600), updatedAt: Date(), lastFinishedAt: Date().addingTimeInterval(-720), completedTurnID: "demo-history-turn", providerID: "codex", modelID: "gpt-6-astra")
        let question = Session(id: "demo-question", title: "A quick design choice", projectID: project.id, hostID: project.hostID, path: project.path, createdAt: Date().addingTimeInterval(-7200), updatedAt: Date().addingTimeInterval(-1800), awaitingInput: true, activity: "Waiting for response", inputRequestID: "demo-input", providerID: "codex", modelID: "gpt-6-astra")
        workspace = WorkspaceState(connection: .online, hosts: [Host(id: "demo-mac", name: "Demo Mac", online: true)], projects: [project], sessions: [history, question], profile: UserProfile(id: "test-mode", displayName: "Test mode"), devices: [
            ConnectedDevice(id: "demo-mac", name: "Demo Mac", platform: "macos", online: true, isExecutionHost: true),
            ConnectedDevice(id: "demo-phone", name: "This device", platform: "ios", online: true, isExecutionHost: false, isCurrent: true)
        ])
        sessions[history.id] = SessionState(id: history.id, messages: [
            TranscriptMessage(id: "demo-message-1", role: "user", text: "Make this workspace feel a little calmer."),
            TranscriptMessage(id: "demo-message-2", role: "assistant", text: "Ready when you are. Start a new session, choose a model, or send a message here to try streaming and changed files. Everything in test mode stays on this device.")
        ], selection: ModelSelection(providerID: "codex", modelID: "gpt-6-astra"))
        sessions[question.id] = SessionState(id: question.id, messages: [
            TranscriptMessage(id: "demo-question-message", role: "assistant", text: "Before I continue, which details should I focus on? You can choose several or write your own answer.")
        ], selection: ModelSelection(providerID: "codex", modelID: "gpt-6-astra"), input: InputRequest(id: "demo-input", questions: [
            InputQuestion(id: "details", title: "What matters most?", options: ["Spacing", "Typography", "Motion"], multiple: true)
        ]))
        onUpdate?(.workspace(workspace))
    }

    public func authorizationURL(state: String) throws -> URL { throw ClientFailure("Test mode does not sign in.") }
    public func exchangeCode(_ code: String) async throws -> [Organization] { throw ClientFailure("Test mode does not use credentials.") }
    public func selectOrganization(_ id: String) async throws { throw ClientFailure("Test mode does not use organizations.") }
    public func signOut() async throws {
        active = false; visibleSessionID = nil
        for task in running.values { task.cancel() }
        running.removeAll(); sessions.removeAll(); patches.removeAll(); attachmentBytes.removeAll()
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
    public func closeSession(_ id: String) { if visibleSessionID == id { visibleSessionID = nil } }
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
        let id = UUID().uuidString
        let project = workspace.projects.first { $0.id == projectID }
        workspace.sessions.insert(Session(id: id, title: "New session", projectID: projectID, hostID: hostID, path: project?.path ?? "", createdAt: Date(), updatedAt: Date(), providerID: selection.providerID, modelID: selection.modelID), at: 0)
        sessions[id] = SessionState(id: id, selection: selection)
        onUpdate?(.workspace(workspace))
        return id
    }

    public func send(sessionID: String, text: String) async throws {
        try await send(sessionID: sessionID, text: text, attachments: [])
    }

    public func send(sessionID: String, text: String, attachments: [LocalAttachment]) async throws {
        guard active, var state = sessions[sessionID] else { throw ClientFailure("Open a session first.") }
        guard !state.working else { throw ClientFailure("Wait for the reply, or stop it first.") }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty || !attachments.isEmpty else { return }
        for attachment in attachments { try attachment.validate() }
        let remote = attachments.map { attachment -> RemoteAttachment in
            let path = "demo://" + sessionID + "/" + attachment.id
            attachmentBytes[path] = attachment.data
            return RemoteAttachment(path: path, name: attachment.name, mimeType: attachment.mimeType)
        }
        // A stopped new turn must never borrow the previous turn's file changes.
        patches[sessionID] = nil
        let userID = UUID().uuidString
        state.messages.append(TranscriptMessage(id: userID, role: "user", text: clean, attachments: remote))
        let replyID = UUID().uuidString
        state.messages.append(TranscriptMessage(id: replyID, role: "assistant", text: "", streaming: true,
            subagents: [SubagentStatus(id: "demo-agent-" + replyID, status: "running", detail: "Checking spacing and accessibility in test mode.")]))
        state.working = true
        state.turnID = userID
        state.delivery = ""
        sessions[sessionID] = state
        if let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) {
            workspace.sessions[index].title = clean.isEmpty ? "Attachment review" : String(clean.prefix(58))
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
    public func setArchived(sessionID: String, archived: Bool) async throws {
        guard let index = workspace.sessions.firstIndex(where: { $0.id == sessionID }) else { throw ClientFailure("Session unavailable.") }
        workspace.sessions[index].archived = archived
        onUpdate?(.workspace(workspace))
    }

    public func interrupt(sessionID: String) async throws {
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
        state.messages.append(TranscriptMessage(id: UUID().uuidString, role: "assistant", text: "Your choices are saved for this demo. Send a message to try a streaming reply."))
        sessions[sessionID] = state
        onUpdate?(.session(state))
    }

    private func finish(_ id: String, interrupted: Bool) {
        running[id] = nil
        guard var state = sessions[id] else { return }
        state.working = false
        state.delivery = interrupted ? "Stopped" : ""
        if !state.messages.isEmpty {
            state.messages[state.messages.count - 1].streaming = false
            state.messages[state.messages.count - 1].subagents = state.messages[state.messages.count - 1].subagents.map {
                SubagentStatus(id: $0.id, status: "done", detail: interrupted ? "Stopped in test mode." : "Review completed in test mode.")
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
        workspace.projects.append(Project(id: id, name: path.split(separator: "/").last.map(String.init) ?? "Project", path: path, hostID: hostID))
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
