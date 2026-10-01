import Foundation

public struct ObservedPullRequest: Codable, Sendable {
    public var sessionID: String
    public var afterMessageID: String?
    public var request: PullRequest
    public init(sessionID: String, afterMessageID: String?, request: PullRequest) { self.sessionID = sessionID; self.afterMessageID = afterMessageID; self.request = request }
}

public struct LocalPreferences: Codable, Sendable {
    public var drafts: [String: String] = [:]
    public var favorites: Set<String> = []
    public var backgroundEnabled = false
    public var changes: [CapturedTurnChanges] = []
    public var pullRequests: [ObservedPullRequest] = []
    public init() {}
    private enum CodingKeys: String, CodingKey { case drafts, favorites, backgroundEnabled, changes, pullRequests }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        drafts = try values.decodeIfPresent([String: String].self, forKey: .drafts) ?? [:]
        favorites = try values.decodeIfPresent(Set<String>.self, forKey: .favorites) ?? []
        backgroundEnabled = try values.decodeIfPresent(Bool.self, forKey: .backgroundEnabled) ?? false
        changes = try values.decodeIfPresent([CapturedTurnChanges].self, forKey: .changes) ?? []
        pullRequests = try values.decodeIfPresent([ObservedPullRequest].self, forKey: .pullRequests) ?? []
    }
}

/// One bounded file per account. Demo deliberately never constructs this store.
public actor LocalStateStore {
    private let url: URL
    public init(accountKey: String, root: URL? = nil) {
        let base = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let name = Data(accountKey.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
        url = base.appendingPathComponent("ZRemote/Accounts", isDirectory: true).appendingPathComponent(name, isDirectory: true).appendingPathComponent("preferences.json")
    }
    public func load() throws -> LocalPreferences {
        guard FileManager.default.fileExists(atPath: url.path) else { return LocalPreferences() }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard ((attributes[.size] as? NSNumber)?.intValue ?? 0) <= 20_000_000 else { throw ClientFailure("The local cache is too large to restore.") }
        return try JSONDecoder().decode(LocalPreferences.self, from: Data(contentsOf: url))
    }
    public func save(_ state: LocalPreferences) throws {
        let data = try JSONEncoder().encode(state)
        guard data.count <= 20_000_000 else { throw ClientFailure("The local cache is full.") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
    public func clear() throws {
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
