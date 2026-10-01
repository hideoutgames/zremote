import Foundation

public struct ComposerReference: Equatable, Sendable {
    public let kind: ComposerTokenKind
    public let sourceRange: NSRange
    public let displayRange: NSRange
    public let label: String
}

public struct ComposerTextEdit: Equatable, Sendable {
    public let text: String
    public let cursorUTF16: Int
}

/// The durable draft keeps host references byte-for-byte. Only the editor and
/// user-message presentation substitute their short labels. All offsets are UTF-16.
public struct ComposerReferenceText: Sendable {
    public let source: String
    public let text: String
    public let references: [ComposerReference]

    public init(_ source: String) {
        self.source = source
        let raw = source as NSString
        var output = "", references: [ComposerReference] = [], end = 0
        for link in ReferenceLinks.scan(source) {
            output += raw.substring(with: NSRange(location: end, length: link.range.location - end))
            let range = NSRange(location: (output as NSString).length, length: (link.label as NSString).length)
            output += link.label
            references.append(ComposerReference(kind: link.kind, sourceRange: link.range, displayRange: range, label: link.label))
            end = NSMaxRange(link.range)
        }
        output += raw.substring(from: end)
        self.text = output
        self.references = references
    }

    public func sourceOffset(_ displayOffset: Int) -> Int {
        var delta = 0
        for reference in references {
            let range = reference.displayRange
            if displayOffset <= range.location { break }
            if displayOffset < NSMaxRange(range) {
                return displayOffset - range.location < range.length / 2 ? reference.sourceRange.location : NSMaxRange(reference.sourceRange)
            }
            delta += reference.sourceRange.length - range.length
        }
        return min(max(0, displayOffset + delta), (source as NSString).length)
    }

    public func displayOffset(_ sourceOffset: Int) -> Int {
        var delta = 0
        for reference in references {
            if sourceOffset <= reference.sourceRange.location { break }
            if sourceOffset < NSMaxRange(reference.sourceRange) { return NSMaxRange(reference.displayRange) }
            delta += reference.sourceRange.length - reference.displayRange.length
        }
        return min(max(0, sourceOffset - delta), (text as NSString).length)
    }

    public func selection(_ range: NSRange, previous: NSRange? = nil, inSource: Bool = false) -> NSRange {
        let ranges = references.map { inSource ? $0.sourceRange : $0.displayRange }
        let length = ((inSource ? source : text) as NSString).length
        var start = min(max(0, range.location), length), end = min(max(0, NSMaxRange(range)), length)
        end = max(start, end)
        if start == end {
            if let token = ranges.first(where: { start > $0.location && start < NSMaxRange($0) }) {
                let direction = previous?.length == 0 ? start - previous!.location : 0
                if direction == 1 { start = NSMaxRange(token) }
                else if direction == -1 { start = token.location }
                else { start = start - token.location < token.length / 2 ? token.location : NSMaxRange(token) }
                end = start
            }
        } else {
            for token in ranges where start < NSMaxRange(token) && end > token.location {
                start = min(start, token.location); end = max(end, NSMaxRange(token))
            }
        }
        return NSRange(location: start, length: end - start)
    }

    public func replacing(_ range: NSRange, with replacement: String, inSource: Bool = false) -> ComposerTextEdit {
        let expanded = selection(range, inSource: inSource)
        let start = inSource ? expanded.location : sourceOffset(expanded.location)
        let end = inSource ? NSMaxRange(expanded) : sourceOffset(NSMaxRange(expanded))
        return ComposerTextEdit(text: (source as NSString).replacingCharacters(in: NSRange(location: start, length: end - start), with: replacement),
                                cursorUTF16: start + (replacement as NSString).length)
    }

    /// Prefer the native selection over a generic diff so equal-looking file
    /// labels backed by different paths keep the selected identity.
    public func editing(_ value: String, selection: NSRange, inSource: Bool = false) -> ComposerTextEdit {
        let before = (inSource ? source : text) as NSString, after = value as NSString
        let start = min(max(0, selection.location), before.length)
        let end = min(max(start, NSMaxRange(selection)), before.length)
        let inserted = after.length - before.length + end - start
        if inserted >= 0, start + inserted <= after.length,
           before.substring(to: start) == after.substring(to: start), before.substring(from: end) == after.substring(from: start + inserted) {
            return replacing(NSRange(location: start, length: end - start), with: after.substring(with: NSRange(location: start, length: inserted)), inSource: inSource)
        }
        let removed = before.length - after.length
        if start == end, removed > 0 {
            for from in [start - removed, start] where from >= 0 && from + removed <= before.length {
                let range = NSRange(location: from, length: removed)
                if before.replacingCharacters(in: range, with: "") == value { return replacing(range, with: "", inSource: inSource) }
            }
        }
        var prefix = 0, suffix = 0
        while prefix < min(before.length, after.length), before.character(at: prefix) == after.character(at: prefix) { prefix += 1 }
        if prefix > 0, prefix < before.length, (0xDC00...0xDFFF).contains(before.character(at: prefix)) { prefix -= 1 }
        while suffix < min(before.length, after.length) - prefix,
              before.character(at: before.length - suffix - 1) == after.character(at: after.length - suffix - 1) { suffix += 1 }
        if suffix > 0, (0xDC00...0xDFFF).contains(before.character(at: before.length - suffix)) { suffix -= 1 }
        return replacing(NSRange(location: prefix, length: before.length - prefix - suffix),
                         with: after.substring(with: NSRange(location: prefix, length: after.length - prefix - suffix)), inSource: inSource)
    }
}

/// A small Markdown-aware scanner for the two reference schemes. Code, images,
/// comments, escaped links and invalid payloads stay literal and editable.
private enum ReferenceLinks {
    struct Link { let range: NSRange; let kind: ComposerTokenKind; let label: String }

    static func scan(_ text: String) -> [Link] {
        guard text.contains("zeron-invoke:") || text.contains("zeron-file:") else { return [] }
        let raw = text as NSString, units = Array(text.utf16)
        let fences = codeRanges(raw)
        var result: [Link] = [], index = 0, fence = 0
        func closing(_ start: Int, open: UInt16, close: UInt16) -> Int? {
            var position = start + 1, depth = 0
            while position < units.count {
                if units[position] == 92 { position += 2; continue }
                if units[position] == open { depth += 1 }
                if units[position] == close {
                    if depth == 0 { return position }
                    depth -= 1
                }
                position += 1
            }
            return nil
        }
        while index < units.count {
            while fence < fences.count, index >= NSMaxRange(fences[fence]) { fence += 1 }
            if fence < fences.count, index >= fences[fence].location { index = NSMaxRange(fences[fence]); continue }
            if units[index] == 92 { index += 2; continue }
            if units[index] == 96 {
                var count = 1
                while index + count < units.count, units[index + count] == 96 { count += 1 }
                var next = index + count, close: Int?
                while next < units.count {
                    if units[next] != 96 { next += 1; continue }
                    var size = 1
                    while next + size < units.count, units[next + size] == 96 { size += 1 }
                    if size == count { close = next + size; break }
                    next += size
                }
                index = close ?? index + count; continue
            }
            if units[index] == 60, raw.substring(from: index).hasPrefix("<!--") {
                let end = raw.range(of: "-->", range: NSRange(location: index + 4, length: raw.length - index - 4))
                index = end.location == NSNotFound ? units.count : NSMaxRange(end); continue
            }
            let image = units[index] == 33 && index + 1 < units.count && units[index + 1] == 91
            if units[index] == 91 || image {
                let left = image ? index + 1 : index
                if let right = closing(left, open: 91, close: 93), right + 1 < units.count, units[right + 1] == 40,
                   let end = closing(right + 1, open: 40, close: 41) {
                    let range = NSRange(location: index, length: end + 1 - index)
                    if !image {
                        let label = raw.substring(with: NSRange(location: left + 1, length: right - left - 1))
                        let destination = raw.substring(with: NSRange(location: right + 2, length: end - right - 2))
                        if let decoded = decode(label: label, destination: destination) {
                            result.append(Link(range: range, kind: decoded.0, label: decoded.1))
                        }
                    }
                    index = end + 1; continue
                }
            }
            index += 1
        }
        return result
    }

    private static func codeRanges(_ raw: NSString) -> [NSRange] {
        var ranges: [NSRange] = [], index = 0, start: Int?, marker: Character?, count = 0
        while index < raw.length {
            let range = raw.lineRange(for: NSRange(location: index, length: 0))
            let line = raw.substring(with: range).trimmingCharacters(in: .newlines)
            let spaces = line.prefix { $0 == " " }.count
            let content = line.dropFirst(min(3, spaces))
            if spaces <= 3, let first = content.first, first == "`" || first == "~" {
                let size = content.prefix { $0 == first }.count
                if size >= 3 {
                    if start == nil { start = index; marker = first; count = size }
                    else if marker == first, size >= count, content.dropFirst(size).trimmingCharacters(in: .whitespaces).isEmpty {
                        ranges.append(NSRange(location: start!, length: NSMaxRange(range) - start!)); start = nil
                    }
                }
            } else if start == nil, spaces >= 4 || line.hasPrefix("\t") { ranges.append(range) }
            index = NSMaxRange(range)
        }
        if let start { ranges.append(NSRange(location: start, length: raw.length - start)) }
        return ranges
    }

    private static func escaped(_ text: String) -> String {
        text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]").replacingOccurrences(of: "`", with: "\\`")
    }
    private static func valid(_ value: String, allowSpaces: Bool = false) -> Bool {
        !value.isEmpty && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || (!allowSpaces && CharacterSet.whitespacesAndNewlines.contains($0)) }
    }
    private static func matches(_ raw: String, _ label: String) -> Bool {
        raw == escaped(label) || raw == escaped(label).replacingOccurrences(of: "\\`", with: "`")
    }
    private static func decode(label: String, destination: String) -> (ComposerTokenKind, String)? {
        if destination.hasPrefix("zeron-invoke:") {
            let hex = Array(destination.dropFirst("zeron-invoke:".count).utf8)
            guard !hex.isEmpty, hex.count.isMultiple(of: 2) else { return nil }
            var bytes = Data()
            for offset in stride(from: 0, to: hex.count, by: 2) {
                guard let value = UInt8(String(decoding: hex[offset...offset + 1], as: UTF8.self), radix: 16) else { return nil }
                bytes.append(value)
            }
            guard let object = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
                  let kindName = object["kind"] as? String, let kind = ComposerTokenKind(rawValue: kindName), kind != .file,
                  let name = object["name"] as? String, valid(name), matches(label, kind.prefix + name) else { return nil }
            if kind == .skill {
                guard let path = object["path"] as? String, valid(path, allowSpaces: true) else { return nil }
                if let command = object["command"], !(command is NSNull) {
                    guard let command = command as? [String: Any], let name = command["name"] as? String,
                          valid(name), name.allSatisfy({ $0.isLetter || $0.isNumber || "-_:.".contains($0) }),
                          let harness = command["harness"] as? String, !harness.isEmpty else { return nil }
                }
            }
            return (kind, kind.prefix + name)
        }
        if destination.hasPrefix("zeron-file:"), let path = String(destination.dropFirst("zeron-file:".count)).removingPercentEncoding {
            let folder = path.hasSuffix("/"), trimmed = folder ? String(path.dropLast()) : path
            let parts = trimmed.split(separator: "/", omittingEmptySubsequences: false)
            guard valid(trimmed, allowSpaces: true), !trimmed.contains("\\"),
                  parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.lowercased() != ".git" }),
                  let basename = parts.last, matches(label, String(basename)) else { return nil }
            return (.file, "@" + basename + (folder ? "/" : ""))
        }
        return nil
    }
}
