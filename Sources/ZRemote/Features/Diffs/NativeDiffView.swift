import SwiftUI
import ZRemoteCore

/// The same native read-only component is used by both completed-turn surfaces.
/// On Android SkipFuseUI renders the shared view through the native Compose bridge.
public struct NativeDiffView: View {
    public let document: DiffDocument
    @State private var parsed: ParsedDiff?

    public init(document: DiffDocument) {
        self.document = document
    }

    private var selectedFile: UnifiedDiffFile? {
        guard let parsed else { return nil }
        return parsed.files.first { $0.path == document.path || $0.oldPath == document.path }
            ?? (parsed.files.count == 1 ? parsed.files.first : nil)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            if document.isBinary || selectedFile?.isBinary == true {
                message(symbol: "doc", title: "Binary file", detail: "A text diff is not available for this file.")
            } else if document.patch == nil || document.patch?.isEmpty == true {
                message(symbol: "doc.text", title: "Diff unavailable", detail: "This change has no saved diff to display.")
            } else if parsed == nil {
                ProgressView("Preparing diff…")
                    .tint(Palette.text)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let file = selectedFile, !file.hunks.isEmpty {
                fileBody(file)
            } else if parsed?.hasUnsupportedContent == true {
                message(symbol: "doc.text", title: "Preview unavailable", detail: "This diff format cannot be displayed.")
            } else if parsed?.isTruncated == true && selectedFile == nil {
                message(symbol: "doc.text", title: "Preview unavailable", detail: "This file is outside the available portion of the diff.")
            } else {
                message(symbol: "doc.text", title: "No text changes", detail: "The change may be a rename or file metadata update.")
            }
        }
        .background(Palette.background)
        .task(id: document.id) {
            parsed = nil
            guard let patch = document.patch, !patch.isEmpty, !document.isBinary else { return }
            let result = await Task.detached(priority: .userInitiated) {
                UnifiedDiffParser.parse(patch)
            }.value
            guard !Task.isCancelled else { return }
            parsed = result
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            SelectableText(document.path)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Palette.text)
                .fixedSize(horizontal: false, vertical: true)
            if document.isTruncated || parsed?.isTruncated == true || selectedFile?.isPartial == true {
                Label("Partial diff — some changes are unavailable", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(Palette.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Palette.surface)
    }

    private func fileBody(_ file: UnifiedDiffFile) -> some View {
        GeometryReader { geometry in
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(file.hunks) { hunk in
                        Text(hunk.header)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Palette.secondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.surface)
                            .accessibilityLabel("Changed section, \(hunk.header)")
                        ForEach(hunk.lines) { line in
                            DiffCodeRow(line: line)
                        }
                    }
                }
                .frame(minWidth: geometry.size.width, alignment: .leading)
                .padding(.bottom, 24)
            }
        }
    }

    private func message(symbol: String, title: String, detail: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.title)
                .foregroundStyle(Palette.secondary)
                .accessibilityHidden(true)
            Text(title).font(.headline).foregroundStyle(Palette.text)
            Text(detail).font(.subheadline).foregroundStyle(Palette.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct DiffCodeRow: View {
    let line: UnifiedDiffLine

    private var tint: Color {
        switch line.kind {
        case .addition: return Palette.addition
        case .deletion: return Palette.deletion
        case .context: return Palette.text
        case .noNewline: return Palette.secondary
        }
    }

    private var sign: String {
        switch line.kind {
        case .addition: return "+"
        case .deletion: return "−"
        case .noNewline: return "\\"
        case .context: return " "
        }
    }

    private var accessibilityText: String {
        switch line.kind {
        case .addition: return "Added, line \(line.newLine ?? 0), \(line.text)"
        case .deletion: return "Deleted, line \(line.oldLine ?? 0), \(line.text)"
        case .context: return "Line \(line.newLine ?? line.oldLine ?? 0), \(line.text)"
        case .noNewline: return line.text
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(line.oldLine.map(String.init) ?? "")
                .foregroundStyle(Palette.secondary)
                .frame(width: 42, alignment: .trailing)
                .accessibilityHidden(true)
            Text(line.newLine.map(String.init) ?? "")
                .foregroundStyle(Palette.secondary)
                .frame(width: 42, alignment: .trailing)
                .accessibilityHidden(true)
            Text(sign).foregroundStyle(tint).frame(width: 28).accessibilityHidden(true)
            SelectableText(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(tint)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.trailing, 16)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
        }
        .font(.system(.caption, design: .monospaced))
        .padding(.vertical, 3)
        .background(line.kind == .addition || line.kind == .deletion ? tint.opacity(0.10) : Color.clear)
        #if !os(Android)
        .accessibilityElement(children: .ignore)
        #endif
        .accessibilityLabel(accessibilityText)
    }
}
