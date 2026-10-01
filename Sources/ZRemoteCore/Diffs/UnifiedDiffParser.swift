// Adapted from Swift-Diffs PatchParser.swift and Models.swift at
// 7005d406fa362f1bbcc5c76551a9bf222c9a8eb6 (Apache-2.0).
// Native adaptation of @pierre/diffs 1.4.2, Copyright 2025 Pierre Computer Company.
// Modified for ZRemote: bounded parsing, mobile row models, binary/partial states,
// quoted Git paths, and no AppKit, editor, highlighting, or diff generation.
// See Sources/ZRemote/Resources/Licenses/SwiftDiffs-Apache-2.0.txt and
// SwiftDiffs-NOTICE.txt in the same directory.

import Foundation

/// Reads an existing host patch. Does not access files or generate a new diff.
public enum UnifiedDiffParser {
    public static func parse(_ patch: String, maximumLines: Int = 40_000, maximumBytes: Int = 4_194_304) -> ParsedDiff {
        guard maximumLines > 0, maximumBytes > 0 else {
            return ParsedDiff(files: [], isTruncated: !patch.isEmpty, hasUnsupportedContent: false)
        }
        var parser = PatchReader()
        // Split LF bytes rather than Swift Characters: CRLF is one grapheme.
        // Bound retained input and discard the incomplete final line before decoding.
        let bytes = patch.utf8
        let limited = bytes.count > maximumBytes
        var input = Array(bytes.prefix(maximumBytes))
        if limited {
            if let lastLF = input.lastIndex(of: 10) {
                input.removeSubrange((lastLF + 1)..<input.count)
            } else {
                input.removeAll()
            }
        }
        let lines = input.split(separator: 10, omittingEmptySubsequences: false).map { String(decoding: $0, as: UTF8.self) }
        let count = lines.last == "" ? lines.count - 1 : lines.count
        var index = 0
        while index < count {
            if index >= maximumLines {
                parser.truncated = true
                break
            }
            var line = lines[index]
            if line.hasSuffix("\r") { line.removeLast() }
            let next = index + 1 < count ? lines[index + 1] : ""
            parser.consume(line, next: next, sourceIndex: index)
            index += 1
        }
        parser.truncated = parser.truncated || limited
        var result = parser.finish(endingAt: index)
        for fileIndex in result.files.indices {
            let span = parser.sourceSpans[fileIndex]
            var original = lines[span].joined(separator: "\n")
            if span.upperBound < count || input.last == 10 { original += "\n" }
            result.files[fileIndex].patch = original
        }
        if result.files.isEmpty && !result.isTruncated && !patch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            result.hasUnsupportedContent = true
        }
        return result
    }
}

private struct PatchReader {
    var files: [UnifiedDiffFile] = []
    var sourceSpans: [Range<Int>] = []
    var file: UnifiedDiffFile?
    var fileStartLine = 0
    var hunk: UnifiedDiffHunk?
    var oldRemaining = 0
    var newRemaining = 0
    var oldLine = 0
    var newLine = 0
    var truncated = false
    var unsupported = false
    var expectsNewPath = false

    mutating func consume(_ line: String, next: String, sourceIndex: Int) {
        if line.hasPrefix("diff --git ") {
            finishFile(endingAt: sourceIndex)
            let paths = gitHeaderPaths(String(line.dropFirst(11)))
            file = UnifiedDiffFile(id: files.count, oldPath: paths.0, newPath: paths.1)
            fileStartLine = sourceIndex
            expectsNewPath = false
            return
        }
        if line.hasPrefix("diff --cc ") || line.hasPrefix("diff --combined ") {
            finishFile(endingAt: sourceIndex)
            unsupported = true
            return
        }
        if line.hasPrefix("@@ ") {
            finishHunk()
            guard let header = parseHeader(line) else {
                file?.isPartial = true
                unsupported = true
                return
            }
            if file == nil {
                file = UnifiedDiffFile(id: files.count)
                fileStartLine = sourceIndex
            }
            hunk = UnifiedDiffHunk(id: sourceIndex, header: line,
                                   oldStart: header.0, oldCount: header.1,
                                   newStart: header.2, newCount: header.3)
            oldLine = header.0
            newLine = header.2
            oldRemaining = header.1
            newRemaining = header.3
            return
        }
        if line.hasPrefix("@@") {
            finishHunk()
            file?.isPartial = true
            unsupported = true
            return
        }
        if hunk != nil, line == "\\ No newline at end of file" {
            appendLine(.noNewline, text: "No newline at end of file", old: nil, new: nil, id: sourceIndex)
            return
        }
        if hunk != nil, oldRemaining > 0 || newRemaining > 0 {
            switch line.first {
            case " " where oldRemaining > 0 && newRemaining > 0:
                appendLine(.context, text: String(line.dropFirst()), old: oldLine, new: newLine, id: sourceIndex)
                oldLine += 1; newLine += 1; oldRemaining -= 1; newRemaining -= 1
                return
            case "-" where oldRemaining > 0:
                appendLine(.deletion, text: String(line.dropFirst()), old: oldLine, new: nil, id: sourceIndex)
                oldLine += 1; oldRemaining -= 1
                return
            case "+" where newRemaining > 0:
                appendLine(.addition, text: String(line.dropFirst()), old: nil, new: newLine, id: sourceIndex)
                newLine += 1; newRemaining -= 1
                return
            default:
                // Do not turn malformed data into valid-looking code or line counts.
                finishHunk()
                file?.isPartial = true
            }
        }
        if line.hasPrefix("--- "), next.hasPrefix("+++ ") {
            if file == nil || !(file?.hunks.isEmpty ?? true) || hunk != nil {
                finishFile(endingAt: sourceIndex)
                file = UnifiedDiffFile(id: files.count)
                fileStartLine = sourceIndex
            }
            let path = headerPath(String(line.dropFirst(4)))
            file?.oldPath = path
            expectsNewPath = true
            return
        }
        if line.hasPrefix("+++ "), expectsNewPath {
            let path = headerPath(String(line.dropFirst(4)))
            file?.newPath = path
            expectsNewPath = false
            return
        }
        if line.hasPrefix("Binary files ") || line == "GIT binary patch" {
            if file == nil {
                file = UnifiedDiffFile(id: files.count)
                fileStartLine = sourceIndex
            }
            file?.isBinary = true
        } else if line.hasPrefix("rename from ") {
            let path = decodePath(String(line.dropFirst(12)))
            file?.oldPath = path
        } else if line.hasPrefix("rename to ") {
            let path = decodePath(String(line.dropFirst(10)))
            file?.newPath = path
        } else if line.hasPrefix("new file mode ") {
            file?.oldPath = nil
        } else if line.hasPrefix("deleted file mode ") {
            file?.newPath = nil
        }
    }

    mutating func appendLine(_ kind: UnifiedDiffLine.Kind, text: String, old: Int?, new: Int?, id: Int) {
        // One minified source line must not create a multi-megabyte text layout.
        let oversized = text.utf8.count > 16_384
        if oversized { file?.isPartial = true }
        let display = oversized ? String(text.prefix(4_096)) + " …" : text
        hunk?.lines.append(UnifiedDiffLine(id: id, kind: kind, text: display, oldLine: old, newLine: new))
    }

    mutating func finishHunk() {
        guard let current = hunk else { return }
        if oldRemaining != 0 || newRemaining != 0 { file?.isPartial = true }
        file?.hunks.append(current)
        hunk = nil
        oldRemaining = 0
        newRemaining = 0
    }

    mutating func finishFile(endingAt endLine: Int) {
        finishHunk()
        if let current = file {
            files.append(current)
            sourceSpans.append(fileStartLine..<endLine)
        }
        file = nil
    }

    mutating func finish(endingAt endLine: Int) -> ParsedDiff {
        if truncated { file?.isPartial = true }
        finishFile(endingAt: endLine)
        return ParsedDiff(files: files, isTruncated: truncated, hasUnsupportedContent: unsupported)
    }

    private func parseHeader(_ line: String) -> (Int, Int, Int, Int)? {
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 4, parts[0] == "@@", parts[3] == "@@",
              let old = parseRange(String(parts[1]), prefix: "-"),
              let new = parseRange(String(parts[2]), prefix: "+") else { return nil }
        return (old.0, old.1, new.0, new.1)
    }

    private func parseRange(_ text: String, prefix: Character) -> (Int, Int)? {
        guard text.first == prefix else { return nil }
        let values = text.dropFirst().split(separator: ",", omittingEmptySubsequences: false)
        guard values.count == 1 || values.count == 2,
              let start = Int(values[0]), start >= 0 else { return nil }
        let count = values.count == 2 ? Int(values[1]) : 1
        guard let count, count >= 0, start <= Int.max - count,
              count == 0 || start > 0 else { return nil }
        return (start, count)
    }

    private func headerPath(_ text: String) -> String? {
        let raw = text.components(separatedBy: "\t")[0]
        let path = decodePath(raw)
        if path == "/dev/null" { return nil }
        return stripPrefix(path)
    }

    private func stripPrefix(_ path: String) -> String {
        if path.hasPrefix("a/") || path.hasPrefix("b/") { return String(path.dropFirst(2)) }
        return path
    }

    private func gitHeaderPaths(_ value: String) -> (String?, String?) {
        // Headers may have unquoted spaces. The later ---/+++ headers remain
        // authoritative. Prefer the b/ separator over splitting on every space.
        if value.hasPrefix("\"") {
            var escaped = false
            var cursor = value.index(after: value.startIndex)
            while cursor < value.endIndex {
                let char = value[cursor]
                if char == "\"" && !escaped {
                    let end = value.index(after: cursor)
                    let first = String(value[..<end])
                    let rest = String(value[end...]).trimmingCharacters(in: .whitespaces)
                    return (stripPrefix(decodePath(first)), stripPrefix(decodePath(rest)))
                }
                escaped = char == "\\" && !escaped
                cursor = value.index(after: cursor)
            }
        }
        if let boundary = value.range(of: " b/") {
            return (stripPrefix(String(value[..<boundary.lowerBound])),
                    String(value[boundary.upperBound...]))
        }
        return (nil, nil)
    }

    /// Git quotes non-ASCII bytes using octal escapes, not Unicode scalar escapes.
    private func decodePath(_ raw: String) -> String {
        guard raw.hasPrefix("\""), raw.hasSuffix("\""), raw.count >= 2 else { return raw }
        let units = Array(raw.dropFirst().dropLast().utf8)
        var output: [UInt8] = []
        var index = 0
        while index < units.count {
            let byte = units[index]
            if byte != 92 || index + 1 >= units.count {
                output.append(byte); index += 1; continue
            }
            index += 1
            let escaped = units[index]
            if escaped >= 48 && escaped <= 55 {
                var number = 0
                var digits = 0
                while index < units.count && digits < 3 && units[index] >= 48 && units[index] <= 55 {
                    number = number * 8 + Int(units[index] - 48)
                    index += 1; digits += 1
                }
                if number <= 255 { output.append(UInt8(number)) }
                continue
            }
            switch escaped {
            case 116: output.append(9)
            case 110: output.append(10)
            case 114: output.append(13)
            case 98: output.append(8)
            case 102: output.append(12)
            case 118: output.append(11)
            case 97: output.append(7)
            default: output.append(escaped)
            }
            index += 1
        }
        return String(decoding: output, as: UTF8.self)
    }
}
