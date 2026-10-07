import Foundation

public struct TranscriptRowID: Hashable, Sendable {
    public var messageID: String
    public var kind: String
    public var part: Int
    public init(messageID: String, kind: String, part: Int = 0) {
        self.messageID = messageID; self.kind = kind; self.part = part
    }
}

public struct TranscriptRenderRow: Identifiable, Equatable, Sendable {
    public enum Content: Equatable, Sendable {
        case prompt(TranscriptMessage)
        case text(String, markdown: Bool, secondary: Bool)
        case code(String, language: String?)
        case activity(TranscriptSegment)
        case attachments([RemoteAttachment], timestamp: Date?)
        case subagent(SubagentStatus)
        case completion(CapturedTurnChanges?, duration: TimeInterval?)
        case pullRequest(PullRequest)
        case working
    }
    public var id: TranscriptRowID
    public var content: Content
    public var spacing: Double
    public init(id: TranscriptRowID, content: Content, spacing: Double = 22) {
        self.id = id; self.content = content; self.spacing = spacing
    }
}

public actor TranscriptRowBuilder {
    private struct Parsed {
        var text: String
        var rows: [MessageTextBlock]
    }
    private var cache: [TranscriptRowID: Parsed] = [:]

    public init() {}

    public func rows(messages: [TranscriptMessage], changes: [String: CapturedTurnChanges],
                     pullRequests: [String: [PullRequest]], unanchored: [PullRequest],
                     working: Bool) throws -> [TranscriptRenderRow] {
        var output: [TranscriptRenderRow] = []
        var retained: [TranscriptRowID: Parsed] = [:]
        for message in messages {
            try Task.checkCancellation()
            var first = true
            func append(_ kind: String, _ content: TranscriptRenderRow.Content, part: Int = 0) {
                output.append(.init(id: .init(messageID: message.id, kind: kind, part: part),
                                    content: content, spacing: first ? 22 : 14))
                first = false
            }
            func appendText(_ text: String, streaming: Bool, kind: String = "body") {
                let key = TranscriptRowID(messageID: message.id, kind: kind)
                let parsed: Parsed
                if let old = cache[key], old.text == text {
                    parsed = old
                } else {
                    parsed = Parsed(text: text, rows: Self.blocks(text))
                }
                retained[key] = parsed
                for block in parsed.rows {
                    if block.isCode {
                        append(kind, .code(block.text, language: block.language), part: block.id)
                    } else {
                        append(kind, .text(block.text, markdown: !streaming,
                                           secondary: message.role == "tool"), part: block.id)
                    }
                }
            }
            var inlineSubagents = Set<String>()
            if message.role == "user" {
                if !message.text.isEmpty { append("prompt", .prompt(message)) }
            } else if !message.parts.isEmpty {
                for segment in TranscriptActivity.segments(messageID: message.id, parts: message.parts, streaming: message.streaming) {
                    if segment.kind == "activity" {
                        append(segment.id, .activity(segment))
                    } else if segment.kind == "subagent" {
                        if let agent = message.subagents.first(where: { $0.id == segment.parts.first?.id }) {
                            append(segment.id, .subagent(agent))
                            inlineSubagents.insert(agent.id)
                        }
                    } else if let part = segment.parts.first {
                        appendText(part.text, streaming: segment.live, kind: segment.id)
                    }
                }
            } else if !message.text.isEmpty {
                appendText(message.text, streaming: message.streaming)
            }
            if !message.attachments.isEmpty {
                append("attachments", .attachments(message.attachments, timestamp: message.role == "user" ? message.timestamp : nil))
            }
            for (index, agent) in message.subagents.enumerated() where !inlineSubagents.contains(agent.id) {
                append("subagent", .subagent(agent), part: index)
            }
            if changes[message.id] != nil || message.workedDuration != nil {
                append("completion", .completion(changes[message.id], duration: message.streaming ? nil : message.workedDuration))
            }
            for (index, request) in (pullRequests[message.id] ?? []).enumerated() {
                append("pr", .pullRequest(request), part: index)
            }
        }
        for (index, request) in unanchored.enumerated() {
            output.append(.init(id: .init(messageID: "", kind: "unanchored-pr", part: index), content: .pullRequest(request)))
        }
        if working {
            output.append(.init(id: .init(messageID: "", kind: "working"), content: .working))
        }
        cache = retained
        return output
    }

    private static func blocks(_ text: String) -> [MessageTextBlock] {
        var output: [MessageTextBlock] = []
        for block in ChatText.blocks(in: text) {
            if block.isCode {
                output.append(.init(id: output.count, text: block.text, language: block.language, isCode: true))
                continue
            }
            var buffer = ""
            var count = 0
            for character in block.text {
                buffer.append(character)
                count += 1
                if count >= 4000 && character.isWhitespace {
                    output.append(.init(id: output.count, text: buffer, language: nil, isCode: false))
                    buffer = ""; count = 0
                }
            }
            if !buffer.isEmpty {
                output.append(.init(id: output.count, text: buffer, language: nil, isCode: false))
            }
        }
        return output
    }
}
