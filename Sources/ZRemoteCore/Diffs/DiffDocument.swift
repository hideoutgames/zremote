import Foundation

/// A captured revision, never an instruction to silently load the current checkout.
public struct DiffDocument: Identifiable, Equatable, Sendable {
    public let id: String
    public let path: String
    public let patch: String?
    public let isBinary: Bool
    public let isTruncated: Bool

    public init(id: String, path: String, patch: String?, isBinary: Bool = false, isTruncated: Bool = false) {
        self.id = id
        self.path = path
        self.patch = patch
        self.isBinary = isBinary
        self.isTruncated = isTruncated
    }
}

public struct UnifiedDiffFile: Identifiable, Equatable, Sendable {
    public var id: Int
    public var oldPath: String?
    public var newPath: String?
    public var isBinary = false
    public var isPartial = false
    public var hunks: [UnifiedDiffHunk] = []
    /// Original source slice for this file only, preserving source line endings.
    public var patch = ""

    public var path: String { newPath ?? oldPath ?? "Changed file" }
    public var additions: Int { hunks.reduce(0) { $0 + $1.lines.filter { $0.kind == .addition }.count } }
    public var deletions: Int { hunks.reduce(0) { $0 + $1.lines.filter { $0.kind == .deletion }.count } }
}

public struct UnifiedDiffHunk: Identifiable, Equatable, Sendable {
    public var id: Int
    public let header: String
    public let oldStart: Int
    public let oldCount: Int
    public let newStart: Int
    public let newCount: Int
    public var lines: [UnifiedDiffLine] = []
}

public struct UnifiedDiffLine: Identifiable, Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case context, addition, deletion, noNewline
    }

    /// Stable within the immutable patch revision, including repeated source lines.
    public let id: Int
    public let kind: Kind
    public let text: String
    public let oldLine: Int?
    public let newLine: Int?
}

public struct ParsedDiff: Equatable, Sendable {
    public var files: [UnifiedDiffFile]
    public var isTruncated: Bool
    public var hasUnsupportedContent: Bool
}
