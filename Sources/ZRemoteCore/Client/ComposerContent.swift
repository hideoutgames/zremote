import Foundation

public struct LocalAttachment: Identifiable, Equatable, Sendable {
    public static let maximumBytes = 24 * 1024 * 1024
    public static let maximumDraftBytes = 48 * 1024 * 1024
    public static let maximumPendingBytes = 96 * 1024 * 1024
    public var id: String
    public var name: String
    public var mimeType: String
    public var data: Data
    public init(id: String = UUID().uuidString, name: String, mimeType: String, data: Data) {
        self.id = id; self.name = name; self.mimeType = mimeType; self.data = data
    }
    public func validate() throws {
        guard data.count <= Self.maximumBytes else { throw ClientFailure("Attachments must be 24 MB or smaller.") }
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ClientFailure("This attachment has no filename.") }
    }
}

public struct RemoteAttachment: Identifiable, Equatable, Sendable {
    public var id: String
    public var path: String
    public var name: String
    public var mimeType: String?
    public init(id: String? = nil, path: String, name: String, mimeType: String? = nil) {
        self.id = id ?? path; self.path = path; self.name = name; self.mimeType = mimeType
    }
}

public struct ComposerCompletion: Identifiable, Equatable, Sendable, Codable {
    public var id: String
    public var kind: ComposerTokenKind
    public var title: String
    public var detail: String
    /// Canonical host-readable reference; never reconstruct it from the title.
    public var insertion: String
    public init(id: String, kind: ComposerTokenKind, title: String, detail: String = "", insertion: String) {
        self.id = id; self.kind = kind; self.title = title; self.detail = detail; self.insertion = insertion
    }
}

public struct UserProfile: Equatable, Sendable, Codable {
    public var id: String
    public var displayName: String
    public var email: String?
    public var avatarURL: String?
    public init(id: String, displayName: String, email: String? = nil, avatarURL: String? = nil) {
        self.id = id; self.displayName = displayName; self.email = email; self.avatarURL = avatarURL
    }
}

public struct SubagentStatus: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var status: String
    public var detail: String
    public init(id: String, title: String = "Subagent", status: String, detail: String = "") {
        self.id = id; self.title = title; self.status = status; self.detail = detail
    }
}
