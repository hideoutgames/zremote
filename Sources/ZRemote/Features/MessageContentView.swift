import SwiftUI
import ZRemoteCore

struct MessageContentView: View {
    let message: TranscriptMessage
    @State private var blocks: [MessageTextBlock] = []
    @State private var renderedText = ""

    var body: some View {
        Group {
            if message.role == "user" {
                HighlightedPrompt(text: message.text)
                    .padding(15)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: 22))
                    .nativeContextMenu {
                        Button { NativeClipboard.copy(message.text) } label: {
                            Label("Copy message", systemImage: "doc.on.doc")
                        }
                    }
            } else if renderedText == message.text, !blocks.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(blocks) { block in
                        if block.isCode {
                            CodeBlockView(code: block.text, language: block.language)
                        } else {
                            SelectableText(block.text, markdown: !message.streaming)
                        }
                    }
                }
            } else {
                SelectableText(message.text, markdown: !message.streaming)
            }
        }
        .font(message.role == "tool" ? .subheadline : .body)
        .lineSpacing(5)
        .foregroundStyle(message.role == "tool" ? Palette.secondary : Palette.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: message.text) {
            guard message.role != "user" else { return }
            let text = message.text
            // Keep parsing off the UI thread and avoid scheduling work for every
            // individual token while the host is streaming.
            if message.streaming { try? await Task.sleep(nanoseconds: 120_000_000) }
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

    #if !os(Android)
    private var highlighted: Text {
        let source = text as NSString
        var output = Text("")
        var cursor = 0
        for token in ChatText.tokens(in: text) where token.range.length > 1 {
            output = output + Text(source.substring(with: NSRange(location: cursor, length: token.range.location - cursor)))
            output = output + Text(source.substring(with: token.range)).foregroundColor(Palette.addition).fontWeight(.medium)
            cursor = NSMaxRange(token.range)
        }
        return output + Text(source.substring(from: cursor))
    }
    #endif

    var body: some View {
        #if os(Android)
        Text(text).multilineTextAlignment(.leading)
            .composeModifier {
                HighlightedPromptModifier(text: text, ranges: ChatText.tokens(in: text).flatMap { [$0.range.location, NSMaxRange($0.range)] }, color: Palette.addition)
            }
        #else
        highlighted.multilineTextAlignment(.leading)
        #endif
    }
}

private struct CodeBlockView: View {
    let code: String
    let language: String?
    @State private var copied = false

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
                SelectableText(code)
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
    let color: Color
    func modify(view: any View) -> any View {
        view.material3Text { options in
            let annotated = ComposerTokenTransformation(ranges: ranges, color: color.asComposeColor()).filter(AnnotatedString(text)).text
            return options.copy(text: nil, annotatedText: annotated)
        }
    }
}
#endif
