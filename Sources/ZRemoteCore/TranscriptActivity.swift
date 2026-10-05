import Foundation

/// Ordered display parts from the peer. Tool details are distinct from answer
/// prose and keep their host part IDs while the result streams.
public struct TranscriptPart: Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var text: String
    public var tool: TranscriptTool?
    public var truncated: Bool

    public init(id: String, kind: String, text: String = "", tool: TranscriptTool? = nil, truncated: Bool = false) {
        self.id = id; self.kind = kind; self.text = text; self.tool = tool; self.truncated = truncated
    }
}

public struct TranscriptTool: Equatable, Sendable {
    public var kind: String
    public var label: String
    public var detail: String
    public var path: String?
    public var invocation: String
    public var output: String
    public var outputKind: String
    public var resolved: Bool
    public var failed: Bool
    public var truncated: Bool

    public init(kind: String, label: String, detail: String = "", path: String? = nil, invocation: String = "", output: String = "", outputKind: String = "output", resolved: Bool = false, failed: Bool = false, truncated: Bool = false) {
        self.kind = kind; self.label = label; self.detail = detail; self.path = path
        self.invocation = invocation; self.output = output; self.outputKind = outputKind
        self.resolved = resolved; self.failed = failed; self.truncated = truncated
    }

    public var fileName: String? { path?.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) }
    public var symbol: String {
        switch kind {
        case "exec": return "terminal"
        case "readFile": return "doc.text"
        case "writeFile", "editFile", "applyPatch": return "pencil"
        case "search", "glob": return "magnifyingglass"
        case "webFetch", "webSearch": return "globe"
        case "todo": return "checklist"
        case "mcp": return "puzzlepiece.extension"
        default: return "wrench"
        }
    }
    public var copyText: String { [invocation, output].filter { !$0.isEmpty }.joined(separator: "\n\n") }
}

public struct TranscriptSegment: Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var parts: [TranscriptPart]
    public var live: Bool
    public var summary: String { TranscriptActivity.summary(parts) }
}

/// Official iOS rows.rs/tools.rs at zeronsh/zeron 9e1a111: consecutive tools
/// and thoughts form a group; only the streaming tail defaults to expanded.
public enum TranscriptActivity {
    public static func segments(messageID: String, parts: [TranscriptPart], streaming: Bool) -> [TranscriptSegment] {
        var result: [TranscriptSegment] = []
        var group: [TranscriptPart] = []
        func flush(live: Bool = false) {
            guard let first = group.first else { return }
            result.append(TranscriptSegment(id: messageID + ":activity:" + first.id, kind: "activity", parts: group, live: live))
            group = []
        }
        for part in parts {
            if part.kind == "reasoning" && part.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            if part.kind == "tool" || part.kind == "reasoning" {
                group.append(part)
            } else {
                // An empty text part still marks the host moving on to prose.
                flush()
                if part.kind != "boundary" && (!part.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || part.kind == "subagent") {
                    result.append(TranscriptSegment(id: messageID + ":part:" + part.id, kind: part.kind, parts: [part], live: streaming && part.id == parts.last?.id))
                }
            }
        }
        flush(live: streaming)
        return result
    }

    public static func expanded(override: Bool?, live: Bool) -> Bool { override ?? live }

    public static func summary(_ parts: [TranscriptPart]) -> String {
        let thoughts = parts.filter { $0.kind == "reasoning" }.count
        let tools = parts.compactMap(\.tool)
        var commands = 0, reads = 0, searches = 0, fetches = 0, todos = 0, other = 0
        var edited = Set<String>()
        for tool in tools {
            switch tool.kind {
            case "exec": commands += 1
            case "readFile": reads += 1
            case "writeFile", "editFile", "applyPatch": edited.insert(tool.path ?? "patch")
            case "search", "glob", "webSearch": searches += 1
            case "webFetch": fetches += 1
            case "todo": todos += 1
            default: other += 1
            }
        }
        func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }
        var labels: [String] = []
        if thoughts > 0 { labels.append(thoughts == 1 ? "thought process" : "thought \(thoughts) times") }
        if commands > 0 { labels.append("ran " + count(commands, "command", "commands")) }
        if !edited.isEmpty { labels.append("edited " + count(edited.count, "file", "files")) }
        if reads > 0 { labels.append("read " + count(reads, "file", "files")) }
        if searches > 0 { labels.append("searched " + count(searches, "time", "times")) }
        if fetches > 0 { labels.append("fetched " + count(fetches, "page", "pages")) }
        if todos > 0 { labels.append("updated todos") }
        if other > 0 { labels.append("called " + count(other, "tool", "tools")) }
        let failed = tools.filter(\.failed).count
        if failed > 0 { labels.append("\(failed) failed") }
        let text = labels.joined(separator: " · ")
        return text.prefix(1).uppercased() + text.dropFirst()
    }
}
