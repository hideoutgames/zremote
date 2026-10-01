import Foundation

public enum ClientConnection: String, Sendable, Codable { case signedOut, connecting, online, offline, expired }

public struct Host: Identifiable, Hashable, Sendable, Codable {
    public let id: String
    public var name: String
    public var online: Bool
    public init(id: String, name: String, online: Bool) { self.id = id; self.name = name; self.online = online }
}

public struct Project: Identifiable, Hashable, Sendable, Codable {
    public let id: String
    public var name: String
    public var path: String
    public var hostID: String
    public var isRepository: Bool
    public init(id: String, name: String, path: String, hostID: String, isRepository: Bool = false) { self.id = id; self.name = name; self.path = path; self.hostID = hostID; self.isRepository = isRepository }
    private enum CodingKeys: String, CodingKey { case id, name, path, hostID, isRepository }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        path = try values.decode(String.self, forKey: .path)
        hostID = try values.decode(String.self, forKey: .hostID)
        isRepository = try values.decodeIfPresent(Bool.self, forKey: .isRepository) ?? false
    }
}

public struct PullRequest: Identifiable, Hashable, Sendable, Codable {
    public var id: String { url.isEmpty ? provider + ":" + String(number) : url }
    public var number: UInt64
    public var title: String
    public var url: String
    public var state: String
    public var provider: String
    public var baseRef: String
    public var headRef: String
    public var isDraft: Bool
    public init(number: UInt64, title: String, url: String, state: String, provider: String = "", baseRef: String = "", headRef: String = "", isDraft: Bool = false) {
        self.number = number; self.title = title; self.url = url; self.state = state
        self.provider = provider; self.baseRef = baseRef; self.headRef = headRef; self.isDraft = isDraft
    }
    private enum CodingKeys: String, CodingKey { case number, title, url, state, provider, baseRef, headRef, isDraft }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        number = try values.decode(UInt64.self, forKey: .number)
        title = try values.decode(String.self, forKey: .title)
        url = try values.decode(String.self, forKey: .url)
        state = try values.decode(String.self, forKey: .state)
        provider = try values.decodeIfPresent(String.self, forKey: .provider) ?? ""
        baseRef = try values.decodeIfPresent(String.self, forKey: .baseRef) ?? ""
        headRef = try values.decodeIfPresent(String.self, forKey: .headRef) ?? ""
        isDraft = try values.decodeIfPresent(Bool.self, forKey: .isDraft) ?? false
    }

}

public struct Session: Identifiable, Hashable, Sendable, Codable {
    public let id: String
    public var title: String
    public var projectID: String?
    public var hostID: String
    public var path: String
    public var preview: String
    public var working: Bool
    public var unread: Bool
    public var awaitingInput: Bool
    public var failed: Bool
    public var activity: String
    public var lastFinishedAt: Date?
    public var completedTurnID: String?
    public var inputRequestID: String?
    public var providerID: String
    public var modelID: String?
    public var pullRequest: PullRequest?
    public var pinned: Bool
    public var archived: Bool
    public var createdAt: Date
    public var updatedAt: Date
    public var branch: String?
    public init(id: String, title: String, projectID: String? = nil, hostID: String, path: String = "", preview: String = "", working: Bool = false, unread: Bool = false, pullRequest: PullRequest? = nil, pinned: Bool = false, archived: Bool = false, createdAt: Date = Date(timeIntervalSince1970: 0), updatedAt: Date = Date(timeIntervalSince1970: 0), awaitingInput: Bool = false, failed: Bool = false, activity: String = "", lastFinishedAt: Date? = nil, completedTurnID: String? = nil, inputRequestID: String? = nil, providerID: String = "", modelID: String? = nil, branch: String? = nil) {
        self.id = id; self.title = title; self.projectID = projectID; self.hostID = hostID; self.path = path; self.preview = preview; self.working = working; self.unread = unread; self.pullRequest = pullRequest
        self.pinned = pinned; self.archived = archived; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.awaitingInput = awaitingInput; self.failed = failed; self.activity = activity; self.lastFinishedAt = lastFinishedAt
        self.completedTurnID = completedTurnID; self.inputRequestID = inputRequestID; self.providerID = providerID; self.modelID = modelID; self.branch = branch
    }
    private enum CodingKeys: String, CodingKey {
        case id, title, projectID, hostID, path, preview, working, unread, pullRequest, pinned, archived, createdAt, updatedAt
        case awaitingInput, failed, activity, lastFinishedAt, completedTurnID, inputRequestID, providerID, modelID, branch
    }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        title = try values.decode(String.self, forKey: .title)
        projectID = try values.decodeIfPresent(String.self, forKey: .projectID)
        hostID = try values.decode(String.self, forKey: .hostID)
        path = try values.decodeIfPresent(String.self, forKey: .path) ?? ""
        preview = try values.decodeIfPresent(String.self, forKey: .preview) ?? ""
        working = try values.decodeIfPresent(Bool.self, forKey: .working) ?? false
        unread = try values.decodeIfPresent(Bool.self, forKey: .unread) ?? false
        pullRequest = try values.decodeIfPresent(PullRequest.self, forKey: .pullRequest)
        pinned = try values.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        archived = try values.decodeIfPresent(Bool.self, forKey: .archived) ?? false
        createdAt = try values.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date(timeIntervalSince1970: 0)
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date(timeIntervalSince1970: 0)
        awaitingInput = try values.decodeIfPresent(Bool.self, forKey: .awaitingInput) ?? false
        failed = try values.decodeIfPresent(Bool.self, forKey: .failed) ?? false
        activity = try values.decodeIfPresent(String.self, forKey: .activity) ?? ""
        lastFinishedAt = try values.decodeIfPresent(Date.self, forKey: .lastFinishedAt)
        completedTurnID = try values.decodeIfPresent(String.self, forKey: .completedTurnID)
        inputRequestID = try values.decodeIfPresent(String.self, forKey: .inputRequestID)
        providerID = try values.decodeIfPresent(String.self, forKey: .providerID) ?? ""
        modelID = try values.decodeIfPresent(String.self, forKey: .modelID)
        branch = try values.decodeIfPresent(String.self, forKey: .branch)
    }

}

public struct WorkspaceState: Equatable, Sendable {
    public var connection: ClientConnection
    public var hosts: [Host]
    public var devices: [ConnectedDevice]
    public var projects: [Project]
    public var sessions: [Session]
    public var profile: UserProfile?
    public init(connection: ClientConnection = .signedOut, hosts: [Host] = [], projects: [Project] = [], sessions: [Session] = [], profile: UserProfile? = nil, devices: [ConnectedDevice] = []) { self.devices = devices; self.connection = connection; self.hosts = hosts; self.projects = projects; self.sessions = sessions; self.profile = profile }
}

public struct ModelChoice: Identifiable, Hashable, Sendable, Codable {
    public var id: String
    public var label: String
    public init(id: String, label: String) { self.id = id; self.label = label }
}

public struct ModelOption: Identifiable, Hashable, Sendable, Codable {
    public var id: String
    public var label: String
    public var choices: [ModelChoice]
    public var defaultChoice: String?
    public init(id: String, label: String, choices: [ModelChoice], defaultChoice: String? = nil) { self.id = id; self.label = label; self.choices = choices; self.defaultChoice = defaultChoice }
}

public struct AgentModel: Identifiable, Hashable, Sendable, Codable {
    public var id: String { providerID + "\u{1F}" + modelID }
    public var providerID: String
    public var providerName: String
    public var modelID: String
    public var name: String
    public var detail: String
    public var efforts: [String]
    public var defaultEffort: String?
    public var options: [ModelOption]
    public init(providerID: String, providerName: String, modelID: String, name: String, detail: String = "", efforts: [String] = [], options: [ModelOption] = [], defaultEffort: String? = nil) {
        self.providerID = providerID; self.providerName = providerName; self.modelID = modelID; self.name = name; self.detail = detail; self.efforts = efforts; self.options = options; self.defaultEffort = defaultEffort
    }
}

public struct ModelSelection: Hashable, Sendable, Codable {
    public var providerID: String
    public var modelID: String?
    public var effort: String?
    public var options: [String: String]
    public init(providerID: String = "claude-code", modelID: String? = nil, effort: String? = nil, options: [String: String] = [:]) { self.providerID = providerID; self.modelID = modelID; self.effort = effort; self.options = options }
}

public struct TranscriptMessage: Identifiable, Equatable, Sendable {
    public var id: String
    public var role: String
    public var text: String
    public var streaming: Bool
    public var attachments: [RemoteAttachment]
    public var subagents: [SubagentStatus]
    public var timestamp: Date?
    public var workedDuration: TimeInterval?
    public init(id: String, role: String, text: String, streaming: Bool = false, attachments: [RemoteAttachment] = [], subagents: [SubagentStatus] = [], timestamp: Date? = nil, workedDuration: TimeInterval? = nil) { self.id = id; self.role = role; self.text = text; self.streaming = streaming; self.attachments = attachments; self.subagents = subagents; self.timestamp = timestamp; self.workedDuration = workedDuration }
}

public struct SessionState: Equatable, Sendable {
    public var id: String
    public var messages: [TranscriptMessage]
    public var selection: ModelSelection
    public var working: Bool
    public var delivery: String
    public var deliveryFailed: Bool
    public var turnID: String?
    public var input: InputRequest?
    public var queue: [QueuedMessage]
    public var queueCapabilities: MessageQueueCapabilities
    public var queueError: String?
    public init(id: String, messages: [TranscriptMessage] = [], selection: ModelSelection = .init(), working: Bool = false, delivery: String = "", deliveryFailed: Bool = false, turnID: String? = nil, input: InputRequest? = nil, queue: [QueuedMessage] = [], queueCapabilities: MessageQueueCapabilities = .init(), queueError: String? = nil) { self.id = id; self.messages = messages; self.selection = selection; self.working = working; self.delivery = delivery; self.deliveryFailed = deliveryFailed; self.turnID = turnID; self.input = input; self.queue = queue; self.queueCapabilities = queueCapabilities; self.queueError = queueError }
}

public struct InputQuestion: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var options: [String]
    public var multiple: Bool
    public init(id: String, title: String, options: [String] = [], multiple: Bool = false) { self.id = id; self.title = title; self.options = options; self.multiple = multiple }
}

public struct InputRequest: Identifiable, Equatable, Sendable {
    public var id: String
    public var questions: [InputQuestion]
    public init(id: String, questions: [InputQuestion]) { self.id = id; self.questions = questions }
}

public struct RemoteFolder: Identifiable, Hashable, Sendable {
    public var id: String { path }
    public var name: String
    public var path: String
    public var isRepository: Bool
    public init(name: String, path: String, isRepository: Bool = false) { self.name = name; self.path = path; self.isRepository = isRepository }
}

public struct FolderPage: Equatable, Sendable {
    public var path: String
    public var parent: String?
    public var folders: [RemoteFolder]
    public var partial: Bool
    public init(path: String, parent: String? = nil, folders: [RemoteFolder] = [], partial: Bool = false) { self.path = path; self.parent = parent; self.folders = folders; self.partial = partial }
}

public struct TurnDiff: Equatable, Sendable {
    public var patch: String
    public var paths: [String]
    public var additions: UInt32
    public var deletions: UInt32
    public var partial: Bool
    public init(patch: String, paths: [String] = [], additions: UInt32 = 0, deletions: UInt32 = 0, partial: Bool = false) { self.patch = patch; self.paths = paths; self.additions = additions; self.deletions = deletions; self.partial = partial }
}

public struct Organization: Identifiable, Hashable, Sendable {
    public var id: String
    public var name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}

public enum ClientUpdate: Sendable { case workspace(WorkspaceState), session(SessionState), authenticationExpired }

/// UI-facing peer client. Demo and live implementations share this contract;
/// the live implementation always delegates commands to the host's existing RPCs.
@MainActor public protocol ClientService: AnyObject {
    var onUpdate: (@MainActor (ClientUpdate) -> Void)? { get set }
    var isDemo: Bool { get }
    var accountKey: String? { get }
    func restore() async throws
    func authorizationURL(state: String) throws -> URL
    func exchangeCode(_ code: String) async throws -> [Organization]
    func selectOrganization(_ id: String) async throws
    func signOut() async throws
    func refresh() async throws
    func openSession(_ id: String) async throws
    func closeSession(_ id: String)
    func models(hostID: String) async throws -> [AgentModel]
    func createSession(projectID: String?, hostID: String, selection: ModelSelection) async throws -> String
    func createSession(projectID: String?, hostID: String, selection: ModelSelection, checkout: CheckoutSelection) async throws -> String
    func checkouts(projectID: String, hostID: String) async throws -> [ProjectCheckout]
    func renameSession(sessionID: String, title: String) async throws
    func send(sessionID: String, text: String) async throws
    func send(sessionID: String, text: String, attachments: [LocalAttachment]) async throws
    func send(sessionID: String, text: String, attachments: [LocalAttachment], busy: MessageSendMode) async throws
    func sendQueuedNow(sessionID: String, id: String) async throws
    func moveQueuedMessage(sessionID: String, id: String, delta: Int) async throws
    func deleteQueuedMessage(sessionID: String, id: String) async throws
    func beginQueuedMessageEdit(sessionID: String, id: String) async throws -> QueuedMessageEdit
    func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async throws -> Bool
    /// A nil text cancels the edit; only a confirmed host commit saves text.
    func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async throws
    func readAttachment(sessionID: String, attachment: RemoteAttachment) async throws -> Data
    func complete(kind: ComposerTokenKind, query: String, hostID: String, sessionID: String?, projectID: String?, providerID: String) async throws -> [ComposerCompletion]
    func setPinned(sessionID: String, pinned: Bool) async throws
    func setArchived(sessionID: String, archived: Bool) async throws
    func interrupt(sessionID: String) async throws
    func retryDelivery(sessionID: String) async throws
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws
    func setModel(sessionID: String, selection: ModelSelection) async throws
    func listFolders(hostID: String, path: String?) async throws -> FolderPage
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String
    func createRepository(hostID: String, name: String) async throws -> String
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff
    func setForeground(_ foreground: Bool)
    func agentAccounts(hostID: String) async throws -> AgentAccountsSnapshot
}

// Existing test peers can stay focused on the behavior they exercise. Live and
// demo clients implement every supported operation explicitly.
public extension ClientService {
    func send(sessionID: String, text: String, attachments: [LocalAttachment], busy: MessageSendMode) async throws {
        guard busy == .queue else { throw ClientFailure("Steering is unavailable from this client.") }
        try await send(sessionID: sessionID, text: text, attachments: attachments)
    }
    func sendQueuedNow(sessionID: String, id: String) async throws { throw ClientFailure("Queue actions are unavailable from this client.") }
    func moveQueuedMessage(sessionID: String, id: String, delta: Int) async throws { throw ClientFailure("Queue actions are unavailable from this client.") }
    func deleteQueuedMessage(sessionID: String, id: String) async throws { throw ClientFailure("Queue actions are unavailable from this client.") }
    func beginQueuedMessageEdit(sessionID: String, id: String) async throws -> QueuedMessageEdit { throw ClientFailure("Update the chat host to edit queued messages safely.") }
    func renewQueuedMessageEdit(_ edit: QueuedMessageEdit) async throws -> Bool { false }
    func finishQueuedMessageEdit(_ edit: QueuedMessageEdit, text: String?) async throws { throw ClientFailure("Queue editing is unavailable from this client.") }
    func createSession(projectID: String?, hostID: String, selection: ModelSelection, checkout: CheckoutSelection) async throws -> String {
        guard checkout == .current else { throw ClientFailure("Checkout selection is unavailable from this client.") }
        return try await createSession(projectID: projectID, hostID: hostID, selection: selection)
    }
    func checkouts(projectID: String, hostID: String) async throws -> [ProjectCheckout] { throw ClientFailure("Checkouts are unavailable from this client.") }
    func renameSession(sessionID: String, title: String) async throws { throw ClientFailure("Renaming is unavailable from this client.") }
    func send(sessionID: String, text: String, attachments: [LocalAttachment]) async throws {
        guard attachments.isEmpty else { throw ClientFailure("This client cannot send attachments.") }
        try await send(sessionID: sessionID, text: text)
    }
    func readAttachment(sessionID: String, attachment: RemoteAttachment) async throws -> Data { throw ClientFailure("This attachment is unavailable.") }
    func complete(kind: ComposerTokenKind, query: String, hostID: String, sessionID: String?, projectID: String?, providerID: String) async throws -> [ComposerCompletion] { [] }
    func setPinned(sessionID: String, pinned: Bool) async throws { throw ClientFailure("Pinning is unavailable.") }
    func setArchived(sessionID: String, archived: Bool) async throws { throw ClientFailure("Archiving is unavailable.") }
}

public extension ClientService {
    func agentAccounts(hostID: String) async throws -> AgentAccountsSnapshot { .init(available: false) }
}
