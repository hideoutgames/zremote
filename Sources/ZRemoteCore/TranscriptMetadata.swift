import Foundation

/// Optional, metadata-only deltas carried alongside the peer's existing session
/// signals. Missing fields from older peers never acquire synthetic values.
public enum TranscriptMetadata {
    public struct SubagentTitle: Decodable, Equatable, Sendable {
        public var id: String
        public var title: String
    }

    public struct Entry: Decodable, Equatable, Sendable {
        public var id: String
        public var role: String?
        public var createdAtMs: Int64?
        public var durationMs: Int64?
        public var status: String?
        public var subagentTitles: [SubagentTitle]

        public var timestamp: Date? {
            // Foundation's calendar formatting is bounded to a real calendar
            // date. Zero is the host's absent/legacy timestamp sentinel.
            guard let createdAtMs, createdAtMs > 0, createdAtMs <= 253_402_300_799_999 else { return nil }
            return Date(timeIntervalSince1970: Double(createdAtMs) / 1_000)
        }
        public var workedDuration: TimeInterval? {
            guard role == "assistant", status == "complete", let durationMs, durationMs > 0 else { return nil }
            return Double(durationMs) / 1_000
        }

        private enum CodingKeys: String, CodingKey { case id, role, createdAtMs, durationMs, status, subagentTitles }
        public init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try values.decode(String.self, forKey: .id)
            role = try values.decodeIfPresent(String.self, forKey: .role)
            createdAtMs = try values.decodeIfPresent(Int64.self, forKey: .createdAtMs)
            durationMs = try values.decodeIfPresent(Int64.self, forKey: .durationMs)
            status = try values.decodeIfPresent(String.self, forKey: .status)
            subagentTitles = try values.decodeIfPresent([SubagentTitle].self, forKey: .subagentTitles) ?? []
        }
    }

    public struct Update: Decodable, Equatable, Sendable {
        public var reset: Bool
        public var entries: [Entry]
        public var removedIDs: [String]

        private enum CodingKeys: String, CodingKey { case reset, entries, removedIDs }
        public init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            reset = try values.decodeIfPresent(Bool.self, forKey: .reset) ?? false
            entries = try values.decodeIfPresent([Entry].self, forKey: .entries) ?? []
            removedIDs = try values.decodeIfPresent([String].self, forKey: .removedIDs) ?? []
            var ids: Set<String> = []
            guard entries.allSatisfy({ !$0.id.isEmpty && ids.insert($0.id).inserted }) else {
                throw DecodingError.dataCorruptedError(forKey: .entries, in: values, debugDescription: "Ambiguous message metadata IDs")
            }
        }
    }

    /// Kept by the native adapter for every open session. Consume deltas from
    /// workspace pulls as well as transcript pulls so neither can lose updates.
    public struct Cache: Equatable, Sendable {
        public private(set) var entries: [String: Entry] = [:]
        public init() {}
        public mutating func apply(_ update: Update) {
            if update.reset { entries.removeAll() }
            for id in update.removedIDs { entries[id] = nil }
            for entry in update.entries { entries[entry.id] = entry }
        }
        public mutating func retain(messageIDs: Set<String>) { entries = entries.filter { messageIDs.contains($0.key) } }
    }

    public static func decode(_ json: String) throws -> [String: Update] {
        let rows = try JSONDecoder().decode([SignalEnvelope].self, from: Data(json.utf8))
        var result: [String: Update] = [:]
        for row in rows {
            guard let update = row.messageMetadata else { continue }
            guard !row.sessionID.isEmpty, result[row.sessionID] == nil else {
                throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Ambiguous session metadata IDs"))
            }
            result[row.sessionID] = update
        }
        return result
    }

    /// Applies host metadata before filtering transcript rows. A completed turn
    /// has one footer at its last visible row, where changed files also attach.
    /// Empty completion records remain visible only when a turn has no content.
    public static func applying(_ cache: Cache, to messages: [TranscriptMessage], latestTurnRunning: Bool = false) -> [TranscriptMessage] {
        var result = messages.map { message in
            var message = message
            let metadata = cache.entries[message.id]
            message.timestamp = metadata?.timestamp
            message.workedDuration = nil
            if let metadata {
                var titles: [String: String] = [:]
                for title in metadata.subagentTitles {
                    let value = title.title.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !value.isEmpty { titles[title.id] = value }
                }
                message.subagents = message.subagents.map { subagent in
                    var subagent = subagent
                    if let title = titles[subagent.id] { subagent.title = title }
                    return subagent
                }
            }
            return message
        }
        var start = result.startIndex
        while start < result.endIndex {
            var next = start + 1
            while next < result.endIndex && result[next].role != "user" { next += 1 }
            let turn = start..<next
            let assistants = turn.filter { result[$0].role == "assistant" }
            if !(latestTurnRunning && next == result.endIndex),
               let terminal = assistants.last,
               cache.entries[result[terminal].id]?.status == "complete",
               !turn.contains(where: { result[$0].streaming }),
               let source = assistants.last(where: { cache.entries[result[$0].id]?.workedDuration != nil }) {
                // Match the visible transcript's last row, including attachment,
                // subagent, and system content. Do not put a footer on the user
                // prompt when the assistant only emitted an empty completion.
                let anchor = turn.last(where: { result[$0].role != "user" && hasContent(result[$0]) }) ?? source
                result[anchor].workedDuration = cache.entries[result[source].id]?.workedDuration
            }
            start = next
        }
        return result.filter { hasContent($0) || $0.workedDuration != nil }
    }

    public static func hasContent(_ message: TranscriptMessage) -> Bool {
        message.text.contains { !$0.isWhitespace }
            || message.parts.contains { $0.kind == "tool" || $0.kind == "subagent" || ($0.kind != "boundary" && $0.text.contains { !$0.isWhitespace }) }
            || !message.attachments.isEmpty || !message.subagents.isEmpty
    }

    public static func workLabel(duration: TimeInterval?) -> String? {
        guard let duration, duration.isFinite, duration > 0 else { return nil }
        let wholeMinutes = floor(duration / 60)
        guard wholeMinutes < Double(Int.max) else { return nil }
        let minutes = Int(wholeMinutes)
        guard minutes > 0 else { return "Worked for <1m" }
        let hours = minutes / 60, remainder = minutes % 60
        if hours == 0 { return "Worked for \(minutes)m" }
        return remainder == 0 ? "Worked for \(hours)h" : "Worked for \(hours)h \(remainder)m"
    }

    private struct SignalEnvelope: Decodable {
        var sessionID: String
        var messageMetadata: Update?
    }
}
