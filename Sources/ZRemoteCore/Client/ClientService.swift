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
    public init(id: String, name: String, path: String, hostID: String) { self.id = id; self.name = name; self.path = path; self.hostID = hostID }
}

public struct PullRequest: Hashable, Sendable, Codable {
    public var number: UInt64
    public var title: String
    public var url: String
    public var state: String
    public init(number: UInt64, title: String, url: String, state: String) { self.number = number; self.title = title; self.url = url; self.state = state }
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
    public var pullRequest: PullRequest?
    public init(id: String, title: String, projectID: String? = nil, hostID: String, path: String = "", preview: String = "", working: Bool = false, unread: Bool = false, pullRequest: PullRequest? = nil) {
        self.id = id; self.title = title; self.projectID = projectID; self.hostID = hostID; self.path = path; self.preview = preview; self.working = working; self.unread = unread; self.pullRequest = pullRequest
    }
}

public struct WorkspaceState: Equatable, Sendable {
    public var connection: ClientConnection
    public var hosts: [Host]
    public var projects: [Project]
    public var sessions: [Session]
    public init(connection: ClientConnection = .signedOut, hosts: [Host] = [], projects: [Project] = [], sessions: [Session] = []) { self.connection = connection; self.hosts = hosts; self.projects = projects; self.sessions = sessions }
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
    public var options: [ModelOption]
    public init(providerID: String, providerName: String, modelID: String, name: String, detail: String = "", efforts: [String] = [], options: [ModelOption] = []) {
        self.providerID = providerID; self.providerName = providerName; self.modelID = modelID; self.name = name; self.detail = detail; self.efforts = efforts; self.options = options
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
    public init(id: String, role: String, text: String, streaming: Bool = false) { self.id = id; self.role = role; self.text = text; self.streaming = streaming }
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
    public init(id: String, messages: [TranscriptMessage] = [], selection: ModelSelection = .init(), working: Bool = false, delivery: String = "", deliveryFailed: Bool = false, turnID: String? = nil, input: InputRequest? = nil) { self.id = id; self.messages = messages; self.selection = selection; self.working = working; self.delivery = delivery; self.deliveryFailed = deliveryFailed; self.turnID = turnID; self.input = input }
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
    func send(sessionID: String, text: String) async throws
    func interrupt(sessionID: String) async throws
    func retryDelivery(sessionID: String) async throws
    func respondInput(sessionID: String, requestID: String, answers: [String: [String]]) async throws
    func setModel(sessionID: String, selection: ModelSelection) async throws
    func listFolders(hostID: String, path: String?) async throws -> FolderPage
    func addProject(hostID: String, path: String, isRepository: Bool) async throws -> String
    func createRepository(hostID: String, name: String) async throws -> String
    func turnDiff(sessionID: String, turnID: String) async throws -> TurnDiff
    func setForeground(_ foreground: Bool)
}
