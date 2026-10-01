import Foundation

/// A new session's unsent worktree destination. The host's durable Run command
/// takes ownership after enqueue; until then a failed send must retain this.
public struct PendingWorktreeIntent: Codable, Equatable, Sendable {
    public var projectID: String
    public var repoPath: String
    public var base: String
    public init(projectID: String, repoPath: String, base: String = "HEAD") {
        self.projectID = projectID; self.repoPath = repoPath; self.base = base
    }
}

/// A small atomic file beside one account's peer snapshots. Synchronous writes
/// keep account teardown and session creation in the same actor transaction.
public struct PendingWorktreeStore: Sendable {
    private let url: URL
    public init(directory: URL) { url = directory.appendingPathComponent("pending-worktrees.json") }
    public func load() throws -> [String: PendingWorktreeIntent] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard ((attributes[.size] as? NSNumber)?.intValue ?? 0) <= 1_000_000 else { throw ClientFailure("Pending worktree data is too large to restore.") }
        let values = try JSONDecoder().decode([String: PendingWorktreeIntent].self, from: Data(contentsOf: url))
        guard values.allSatisfy({ !$0.key.isEmpty && !$0.value.projectID.isEmpty && !$0.value.repoPath.isEmpty && !$0.value.base.isEmpty }) else {
            throw ClientFailure("Pending worktree data could not be restored.")
        }
        return values
    }
    public func save(_ values: [String: PendingWorktreeIntent]) throws {
        let data = try JSONEncoder().encode(values)
        guard data.count <= 1_000_000 else { throw ClientFailure("Pending worktree data is full.") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
