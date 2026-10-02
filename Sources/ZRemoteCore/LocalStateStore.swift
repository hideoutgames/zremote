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
    public var theme = AppTheme.system
    public var hapticsEnabled = true
    public var backgroundEnabled = false
    public var backgroundImageData: Data?
    public var backgroundImageName: String?
    public var backgroundEffect = "none"
    public var backgroundFullHeight = false
    public var notifications = NotificationPreferences()
    public var dismissedUsageSessions: Set<String> = []
    public var usageWarnings: [UsageWarning] = []
    public var usageNotifiedSessions: Set<String> = []
    public var notificationEvents: Set<String> = []
    public var sessionFinishedAt: [String: Date] = [:]
    public var changes: [CapturedTurnChanges] = []
    public var pullRequests: [ObservedPullRequest] = []
    public init() {}
    private enum CodingKeys: String, CodingKey { case drafts, favorites, theme, hapticsEnabled, backgroundEnabled, backgroundImageData, backgroundImageName, backgroundEffect, backgroundFullHeight, notifications, dismissedUsageSessions, usageWarnings, usageNotifiedSessions, notificationEvents, sessionFinishedAt, changes, pullRequests }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        drafts = try values.decodeIfPresent([String: String].self, forKey: .drafts) ?? [:]
        favorites = try values.decodeIfPresent(Set<String>.self, forKey: .favorites) ?? []
        theme = AppTheme(rawValue: try values.decodeIfPresent(String.self, forKey: .theme) ?? "system") ?? .system
        hapticsEnabled = try values.decodeIfPresent(Bool.self, forKey: .hapticsEnabled) ?? true
        backgroundEnabled = try values.decodeIfPresent(Bool.self, forKey: .backgroundEnabled) ?? false
        let image = try values.decodeIfPresent(Data.self, forKey: .backgroundImageData)
        backgroundImageData = image.flatMap { $0.count <= 2_000_000 ? $0 : nil }
        backgroundImageName = backgroundImageData == nil ? nil : try values.decodeIfPresent(String.self, forKey: .backgroundImageName)
        backgroundEffect = try values.decodeIfPresent(String.self, forKey: .backgroundEffect) ?? "none"
        backgroundFullHeight = try values.decodeIfPresent(Bool.self, forKey: .backgroundFullHeight) ?? false
        notifications = try values.decodeIfPresent(NotificationPreferences.self, forKey: .notifications) ?? NotificationPreferences()
        dismissedUsageSessions = try values.decodeIfPresent(Set<String>.self, forKey: .dismissedUsageSessions) ?? []
        usageWarnings = UsageLimitRules.mergeWarnings(
            try values.decodeIfPresent([UsageWarning].self, forKey: .usageWarnings) ?? [], observations: [], dismissed: dismissedUsageSessions)
        usageNotifiedSessions = try values.decodeIfPresent(Set<String>.self, forKey: .usageNotifiedSessions) ?? []
        notificationEvents = try values.decodeIfPresent(Set<String>.self, forKey: .notificationEvents) ?? []
        sessionFinishedAt = try values.decodeIfPresent([String: Date].self, forKey: .sessionFinishedAt) ?? [:]
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
