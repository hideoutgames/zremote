import Foundation

public enum ComposerTokenKind: String, Codable, Sendable {
    case command, skill, file
    public var prefix: String {
        switch self { case .command: return "/"; case .skill: return "$"; case .file: return "@" }
    }
}

public struct ComposerToken: Equatable, Sendable {
    public let kind: ComposerTokenKind
    /// UIKit and Compose selections both use UTF-16 offsets.
    public let range: NSRange
    public let text: String
    public var query: String {
        let body = String(text.dropFirst())
        return body.hasPrefix("\"") ? String(body.dropFirst()).replacingOccurrences(of: "\"", with: "") : body
    }
}

public struct MessageTextBlock: Identifiable, Equatable, Sendable {
    public let id: Int
    public let text: String
    public let language: String?
    public let isCode: Bool
}

public enum ChatText {
    // Whitespace boundaries avoid treating email addresses, URLs and paths as
    // commands. Quoted file references preserve spaces in remote file names.
    private static let tokenPattern = #"(?<!\S)([/@$])(?:"[^"\r\n]*"?|[^\s`<>"()\[\]{},;!?]*)"#

    public static func tokens(in text: String) -> [ComposerToken] {
        guard let expression = try? NSRegularExpression(pattern: tokenPattern) else { return [] }
        let source = text as NSString
        return expression.matches(in: text, range: NSRange(location: 0, length: source.length)).compactMap { match in
            let raw = source.substring(with: match.range)
            let kind: ComposerTokenKind
            switch raw.first {
            case "/": kind = .command
            case "$": kind = .skill
            case "@": kind = .file
            default: return nil
            }
            return ComposerToken(kind: kind, range: match.range, text: raw)
        }
    }

    public static func activeToken(in text: String, cursorUTF16: Int) -> ComposerToken? {
        let source = text as NSString
        guard cursorUTF16 >= 0, cursorUTF16 <= source.length else { return nil }
        // Completing at the caret replaces the whole token, including any suffix
        // after it, while preserving all surrounding text.
        guard let token = tokens(in: text).first(where: {
            cursorUTF16 > $0.range.location && cursorUTF16 <= NSMaxRange($0.range)
        }) else { return nil }
        let prefixRange = NSRange(location: token.range.location, length: cursorUTF16 - token.range.location)
        return ComposerToken(kind: token.kind, range: token.range, text: source.substring(with: prefixRange))
    }

    public static func inserting(_ value: String, for token: ComposerToken, in text: String) -> (text: String, cursorUTF16: Int)? {
        let source = text as NSString
        guard token.range.location >= 0, NSMaxRange(token.range) <= source.length,
              let current = tokens(in: text).first(where: { $0.range == token.range }), current.kind == token.kind else { return nil }
        let reference = ComposerReferenceText(value).references.first
        let canonical = reference?.sourceRange == NSRange(location: 0, length: (value as NSString).length) && reference?.kind == token.kind
        var replacement = canonical || value.hasPrefix(token.kind.prefix) ? value : token.kind.prefix + value
        if !canonical, token.kind == .file, replacement.contains(where: \.isWhitespace), !replacement.hasPrefix("@\"") {
            replacement = "@\"" + String(replacement.dropFirst()).replacingOccurrences(of: "\"", with: "") + "\""
        }
        let end = NSMaxRange(token.range)
        if end == source.length || !CharacterSet.whitespacesAndNewlines.contains(UnicodeScalar(source.character(at: end)) ?? " ") {
            replacement += " "
        }
        return (source.replacingCharacters(in: token.range, with: replacement), token.range.location + (replacement as NSString).length)
    }

    /// Preserve code bytes, indentation and final line endings for Copy. Only
    /// complete fence lines are syntax; an unclosed streaming fence remains code.
    public static func blocks(in text: String) -> [MessageTextBlock] {
        var output: [MessageTextBlock] = []
        var buffer = ""
        var marker: Character?
        var fenceLength = 0
        var language: String?
        var offset = text.startIndex
        func append(code: Bool) {
            let content = code ? buffer : buffer.trimmingCharacters(in: .whitespacesAndNewlines)
            buffer = ""
            guard !content.isEmpty else { return }
            output.append(MessageTextBlock(id: output.count, text: content, language: code ? language : nil, isCode: code))
        }
        while offset < text.endIndex {
            let next = text[offset...].firstIndex(where: \.isNewline).map { text.index(after: $0) } ?? text.endIndex
            let line = String(text[offset..<next])
            let trimmed = line.trimmingCharacters(in: .newlines)
            let leadingSpaces = trimmed.prefix { $0 == " " }.count
            let content = trimmed.dropFirst(min(leadingSpaces, 3))
            let character = content.first
            let count = (character == "`" || character == "~") ? content.prefix { $0 == character }.count : 0
            if fenceLength > 0, leadingSpaces <= 3, let activeMarker = marker, character == activeMarker, count >= fenceLength,
               content.dropFirst(count).trimmingCharacters(in: .whitespaces).isEmpty {
                append(code: true)
                language = nil
                marker = nil
                fenceLength = 0
            } else if fenceLength == 0, leadingSpaces <= 3, count >= 3 {
                append(code: false)
                marker = character
                fenceLength = count
                language = String(content.dropFirst(count)).trimmingCharacters(in: .whitespaces)
            } else {
                buffer += line
            }
            offset = next
        }
        append(code: fenceLength > 0)
        return output
    }
}
