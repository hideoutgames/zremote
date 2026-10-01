import Foundation

/// An immutable file revision saved with a completed turn. Missing evidence is
/// optional, so an unavailable diff never masquerades as zero changed lines.
public struct CapturedFileChange: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public let path: String
    public let patch: String?
    public let isBinary: Bool
    public let isPartial: Bool
    public let additions: Int?
    public let deletions: Int?

    public init(id: String, path: String, patch: String?, isBinary: Bool = false,
                isPartial: Bool = false, additions: Int? = nil, deletions: Int? = nil) {
        self.id = id
        self.path = path
        self.patch = patch
        self.isBinary = isBinary
        self.isPartial = isPartial
        self.additions = additions
        self.deletions = deletions
    }

    public var document: DiffDocument {
        DiffDocument(id: id, path: path, patch: patch, isBinary: isBinary, isTruncated: isPartial)
    }
}

public struct CapturedTurnChanges: Codable, Equatable, Sendable {
    public let sessionID: String
    public let turnID: String
    public let files: [CapturedFileChange]
    public let capturedAt: Date

    public init(sessionID: String, turnID: String, files: [CapturedFileChange], capturedAt: Date) {
        self.sessionID = sessionID
        self.turnID = turnID
        self.files = files
        self.capturedAt = capturedAt
    }

    /// Parses off the UI thread. The caller owns account-scoped persistence and
    /// merges any host-declared paths absent from a capped patch as unknown rows.
    public static func capture(sessionID: String, turnID: String, patch: String,
                               capturedAt: Date = Date(), isTruncated: Bool = false, maximumLines: Int = 40_000,
                               maximumBytes: Int = 4_194_304) async throws -> CapturedTurnChanges {
        try Task.checkCancellation()
        let capture = await Task.detached(priority: .userInitiated) {
            let parsed = UnifiedDiffParser.parse(patch, maximumLines: maximumLines, maximumBytes: maximumBytes)
            let files = parsed.files.enumerated().map { index, file in
                let partial = file.isPartial || (isTruncated && index == parsed.files.count - 1)
                let knownCounts = !file.isBinary && !partial
                return CapturedFileChange(id: UUID().uuidString, path: file.path, patch: file.patch,
                                          isBinary: file.isBinary, isPartial: partial,
                                          additions: knownCounts ? file.additions : nil,
                                          deletions: knownCounts ? file.deletions : nil)
            }
            return CapturedTurnChanges(sessionID: sessionID, turnID: turnID, files: files, capturedAt: capturedAt)
        }.value
        try Task.checkCancellation()
        return capture
    }
}
