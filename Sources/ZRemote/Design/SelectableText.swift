import SwiftUI

/// Native selection on both platforms. Compose receives SkipUI's Text so the
/// surrounding font, color, line spacing and Markdown rendering stay intact.
struct SelectableText: View {
    private let text: Text

    init(_ value: String, markdown: Bool = false) {
        text = markdown ? Text(.init(value)) : Text(value)
    }

    var body: some View {
        #if os(Android)
        ComposeView { SelectableTextComposer(text: text) }
        #else
        text.textSelection(.enabled)
        #endif
    }
}

#if SKIP
import androidx.compose.foundation.text.selection.SelectionContainer

// Uses Skip's documented ContentComposer/ComposeView bridge. The container owns
// selection handles and copy actions; text never leaves the device.
struct SelectableTextComposer: ContentComposer {
    let text: Text

    @Composable func Compose(context: ComposeContext) {
        SelectionContainer(modifier: context.modifier) {
            text.Compose(context: context.content())
        }
    }
}
#endif
