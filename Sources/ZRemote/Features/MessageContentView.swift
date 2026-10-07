import SwiftUI
import ZRemoteCore

struct MessageContentView: View {
    let message: TranscriptMessage

    var body: some View {
        Group {
            if message.role == "user" {
                HighlightedPrompt(text: message.text)
                    .padding(15)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22))
                    .nativeContextMenu {
                        Button { NativeClipboard.copy(ComposerReferenceText(message.text).text) } label: {
                            Label("Copy message", systemImage: "doc.on.doc")
                        }
                        if let timestamp = message.timestamp {
                            Divider()
                            Text(messageDate(timestamp))
                        }
                    }
                    .padding(.leading, 36)
            } else if !message.parts.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(TranscriptActivity.segments(messageID: message.id, parts: message.parts, streaming: message.streaming)) { segment in
                        if segment.kind == "activity" {
                            TranscriptActivityView(segment: segment)
                        } else if segment.kind == "subagent" {
                            if let agent = message.subagents.first(where: { $0.id == segment.parts.first?.id }) {
                                SessionEventCard(title: agent.title, subtitle: agent.status.capitalized, active: agent.active)
                            }
                        } else if let part = segment.parts.first {
                            // Reuse the existing markdown/code renderer per prose part.
                            MessageTextContentView(text: part.text, streaming: segment.live, secondary: message.role == "tool")
                        }
                    }
                }
            } else {
                MessageTextContentView(text: message.text, streaming: message.streaming, secondary: message.role == "tool")
            }
        }
        .font(message.role == "tool" ? .subheadline : .body)
        .lineSpacing(5)
        .foregroundStyle(message.role == "tool" ? Palette.secondary : Palette.text)
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }

    private func messageDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

/// Shared renderer for a plain message or one prose part between tool groups.
struct MessageTextContentView: View {
    let text: String
    let streaming: Bool
    let secondary: Bool
    @State var blocks: [MessageTextBlock] = []
    @State var renderedText = ""

    var body: some View {
        Group {
            if renderedText == text, !blocks.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(blocks) { block in
                        if block.isCode { CodeBlockView(code: block.text, language: block.language) }
                        else { AgentSelectableText(value: block.text, markdown: !streaming, secondary: secondary) }
                    }
                }
            } else {
                AgentSelectableText(value: text.trimmingCharacters(in: .whitespacesAndNewlines), markdown: !streaming, secondary: secondary)
            }
        }
        .task(id: text) {
            // Keep parsing off the UI thread and avoid scheduling work for every
            // individual token while the host is streaming.
            if streaming { try? await Task.sleep(nanoseconds: 120_000_000) }
            guard !Task.isCancelled else { return }
            let parsed = await Task.detached(priority: .userInitiated) { ChatText.blocks(in: text) }.value
            guard !Task.isCancelled else { return }
            blocks = parsed
            renderedText = text
        }
    }

}

struct HighlightedPrompt: View {
    let text: String
    private var document: ComposerReferenceText { ComposerReferenceText(text) }

    #if !os(Android)
    private var highlighted: Text {
        let document = self.document
        let source = document.text as NSString
        var output = Text("")
        var cursor = 0
        for reference in document.references {
            output = output + Text(source.substring(with: NSRange(location: cursor, length: reference.displayRange.location - cursor)))
            output = output + Text(reference.label).foregroundColor(reference.kind.referenceColor).fontWeight(.medium)
            cursor = NSMaxRange(reference.displayRange)
        }
        return output + Text(source.substring(from: cursor))
    }
    #endif

    var body: some View {
        #if os(Android)
        Text(document.text).multilineTextAlignment(.leading)
            .composeModifier {
                HighlightedPromptModifier(text: text, ranges: document.references.flatMap { [$0.sourceRange.location, NSMaxRange($0.sourceRange)] },
                                          labels: document.references.map(\.label), kinds: document.references.map { $0.kind.referenceColorIndex },
                                          colors: [ComposerTokenKind.command.referenceColor, ComposerTokenKind.skill.referenceColor, ComposerTokenKind.file.referenceColor])
            }
        #else
        highlighted.multilineTextAlignment(.leading)
        #endif
    }
}

struct CodeBlockView: View {
    let code: String
    let language: String?
    @State var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text((language?.isEmpty == false ? language : nil) ?? "Code")
                    .font(.caption.weight(.medium)).foregroundStyle(Palette.secondary)
                Spacer()
                Button {
                    NativeClipboard.copy(code)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.caption).frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(copied ? "Code copied" : "Copy code")
            }.padding(.horizontal, 14)
            Rectangle().fill(Palette.line).frame(height: 1)
            ScrollView(.horizontal) {
                AgentSelectableText(value: code, code: true)
                    .font(.system(.footnote, design: .monospaced))
                    .lineSpacing(4).padding(14)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.line))
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled { copied = false }
        }
    }
}

#if SKIP
import androidx.compose.ui.text.AnnotatedString

struct HighlightedPromptModifier: ContentModifier {
    let text: String
    let ranges: [Int]
    let labels: [String]
    let kinds: [Int]
    let colors: [Color]
    func modify(view: any View) -> any View {
        view.material3Text { options in
            let annotated = AnnotatedString(text)
            return options.copy(text: nil, annotatedText: annotated)
        }
    }
}
#endif
