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
    private var cache: [String: Parsed] = [:]

    public init() {}

    public func rows(messages: [TranscriptMessage], changes: [String: CapturedTurnChanges],
                     pullRequests: [String: [PullRequest]], unanchored: [PullRequest],
                     working: Bool) throws -> [TranscriptRenderRow] {
        var output: [TranscriptRenderRow] = []
        var retained: [String: Parsed] = [:]
        for message in messages {
            try Task.checkCancellation()
            var first = true
            func append(_ kind: String, _ content: TranscriptRenderRow.Content, part: Int = 0) {
                output.append(.init(id: .init(messageID: message.id, kind: kind, part: part),
                                    content: content, spacing: first ? 22 : 14))
                first = false
            }
            if !message.text.isEmpty {
                if message.role == "user" {
                    append("prompt", .prompt(message))
                } else {
                    let parsed: Parsed
                    if let old = cache[message.id], old.text == message.text {
                        parsed = old
                    } else {
                        parsed = Parsed(text: message.text, rows: Self.blocks(message.text))
                    }
                    retained[message.id] = parsed
                    for block in parsed.rows {
                        if block.isCode {
                            append("body", .code(block.text, language: block.language), part: block.id)
                        } else {
                            append("body", .text(block.text, markdown: !message.streaming,
                                                secondary: message.role == "tool"), part: block.id)
                        }
                    }
                }
            }
            if !message.attachments.isEmpty {
                append("attachments", .attachments(message.attachments, timestamp: message.role == "user" ? message.timestamp : nil))
            }
            for (index, agent) in message.subagents.enumerated() {
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
