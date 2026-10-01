import Foundation

public extension ComposerCompletion {
    var displayTitle: String {
        if kind == .file { return title.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? title }
        return title.hasPrefix(kind.prefix) ? title : kind.prefix + title
    }
    var displayDetail: String {
        guard kind == .file else { return detail }
        if isFolder { return "Folder" }
        let ext = (displayTitle as NSString).pathExtension
        return ext.isEmpty ? "File" : ext.uppercased() + " file"
    }
    var fileSymbol: String? {
        guard kind == .file else { return nil }
        if isFolder { return "folder" }
        switch (displayTitle as NSString).pathExtension.lowercased() {
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "avif", "bmp", "tif", "tiff": return "photo"
        case "zip", "gz", "tar", "7z", "rar", "bz2", "xz": return "archivebox"
        case "swift", "kt", "java", "js", "jsx", "ts", "tsx", "py", "rb", "rs", "go", "c", "h", "cpp", "cs", "sh", "ps1", "html", "css", "json", "yaml", "yml", "toml": return "chevron.left.forwardslash.chevron.right"
        case "mp3", "wav", "m4a", "ogg", "flac", "aac": return "waveform"
        case "mp4", "mov", "webm", "mkv", "avi": return "film"
        default: return "doc.text"
        }
    }
    private var isFolder: Bool { detail == "Folder" || insertion.hasSuffix("/)") }
}

public enum ComposerCompletionPresentation {
    /// Apply the current caret query even if the host returns an unfiltered
    /// catalog. Stable order retains the host's relevance ranking.
    public static func filter(_ items: [ComposerCompletion], kind: ComposerTokenKind, query: String) -> [ComposerCompletion] {
        let query = query.replacingOccurrences(of: "\\", with: "/").folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        var seen: Set<String> = []
        return items.filter { item in
            guard item.kind == kind, kind != .file || ProjectFolderRules.visiblePath(item.title) else { return false }
            let title = item.title.replacingOccurrences(of: "\\", with: "/").folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            var remaining = query[...]
            for character in title where remaining.first == character { remaining = remaining.dropFirst() }
            return remaining.isEmpty && seen.insert(item.id).inserted
        }
    }
}
