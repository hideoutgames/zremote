import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

/// Keeps native editing, selection and input-method composition while decorating
/// references. Selection offsets are UTF-16 on both platform text controls.
struct ComposerTextInput: View {
    @Binding var text: String
    @Binding var cursor: Int
    @Binding var isFocused: Bool
    @Binding var isComposing: Bool
    let selectionRequest: Int
    @FocusState private var androidFocused: Bool

    var body: some View {
        #if os(iOS)
        NativeComposerEditor(text: $text, cursor: $cursor, isFocused: $isFocused, isComposing: $isComposing, selectionRequest: selectionRequest)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text("Message your agent").font(.body).foregroundStyle(Palette.secondary)
                        .padding(.top, 4).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        #else
        TextField("Message your agent", text: $text, axis: .vertical)
            .lineLimit(8)
            .font(.body)
            .focused($androidFocused)
            .accessibilityLabel("Message")
            #if os(Android)
            .composeModifier {
                ComposerTokenModifier(ranges: ChatText.tokens(in: text).flatMap { [$0.range.location, NSMaxRange($0.range)] },
                                      color: Palette.addition, cursor: cursor, selectionRequest: selectionRequest,
                                      onSelection: { cursor = $0 }, onComposition: { isComposing = $0 })
            }
            #endif
            .onChange(of: androidFocused) { _, value in isFocused = value }
            .onChange(of: isFocused) { _, value in androidFocused = value }
            .onChange(of: text) { _, value in if value.isEmpty { isComposing = false } }
        #endif
    }
}

#if os(iOS)
private struct NativeComposerEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var cursor: Int
    @Binding var isFocused: Bool
    @Binding var isComposing: Bool
    let selectionRequest: Int

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.delegate = context.coordinator
        view.textContainerInset = UIEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = .label
        view.tintColor = UIColor(Palette.text)
        view.isScrollEnabled = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityLabel = "Message"
        view.keyboardDismissMode = .interactive
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        view.tintColor = UIColor(Palette.text)
        context.coordinator.parent = self
        context.coordinator.updating = true
        defer { context.coordinator.updating = false }
        // An intentional external reset (for example Send) must discard the
        // old preedit. Ordinary editor updates already match the binding and
        // leave marked text untouched, preserving CJK input and dictation.
        if view.text != text {
            view.unmarkText()
            view.text = text
            context.coordinator.reportCompositionAfterReplacement(view)
        }
        if view.markedTextRange == nil {
            context.coordinator.decorate(view)
            if context.coordinator.lastSelectionRequest != selectionRequest {
                view.selectedRange = NSRange(location: min(max(0, cursor), (text as NSString).length), length: 0)
                context.coordinator.lastSelectionRequest = selectionRequest
            }
        }
        if isFocused && !view.isFirstResponder { view.becomeFirstResponder() }
        if !isFocused && view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let line = UIFont.preferredFont(forTextStyle: .body).lineHeight
        let desired = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let maximum = line * 8 + 8
        uiView.isScrollEnabled = desired > maximum
        return CGSize(width: width, height: min(max(line + 8, desired), maximum))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NativeComposerEditor
        var updating = false
        var lastSelectionRequest = -1
        init(_ parent: NativeComposerEditor) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            guard !updating else { return }
            parent.text = view.text
            parent.cursor = NSMaxRange(view.selectedRange)
            parent.isComposing = view.markedTextRange != nil
            if view.markedTextRange == nil { decorate(view) }
            view.invalidateIntrinsicContentSize()
        }
        func textViewDidChangeSelection(_ view: UITextView) {
            guard !updating else { return }
            parent.cursor = NSMaxRange(view.selectedRange)
            parent.isComposing = view.markedTextRange != nil
        }
        func textViewDidBeginEditing(_ view: UITextView) { if !updating { parent.isFocused = true } }
        func textViewDidEndEditing(_ view: UITextView) { if !updating { parent.isFocused = false } }

        func reportCompositionAfterReplacement(_ view: UITextView) {
            // Publish outside updateUIView, and do not overwrite a newer preedit.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, view.markedTextRange == nil, view.text == self.parent.text else { return }
                self.parent.isComposing = false
            }
        }

        func decorate(_ view: UITextView) {
            let whole = NSRange(location: 0, length: (view.text as NSString).length)
            let selection = view.selectedRange
            let storage = view.textStorage
            storage.beginEditing()
            storage.setAttributes([.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label], range: whole)
            for token in ChatText.tokens(in: view.text) where token.range.length > 1 {
                storage.addAttribute(.foregroundColor, value: UIColor(Palette.addition), range: token.range)
            }
            storage.endEditing()
            view.selectedRange = selection
            view.typingAttributes = [.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label]
        }
    }
}
#endif

#if SKIP
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

struct ComposerTokenModifier: ContentModifier {
    let ranges: [Int]
    let color: Color
    let cursor: Int
    let selectionRequest: Int
    let onSelection: (Int) -> Void
    let onComposition: (Bool) -> Void

    func modify(view: any View) -> any View {
        view.material3TextField { options in
            let lastRequest = remember { mutableStateOf(-1) }
            if lastRequest.value != selectionRequest {
                SideEffect {
                    lastRequest.value = selectionRequest
                    let position = min(max(0, cursor), options.value.text.length)
                    options.onValueChange(options.value.copy(selection: TextRange(position)))
                    onComposition(options.value.composition != nil)
                }
            }
            return options.copy(onValueChange: { value in
                options.onValueChange(value)
                onSelection(value.selection.end)
                onComposition(value.composition != nil)
            }, visualTransformation: ComposerTokenTransformation(ranges: ranges, color: color.asComposeColor()), maxLines: options.maxLines)
        }
    }
}

final class ComposerTokenTransformation: VisualTransformation {
    let ranges: [Int]
    let color: androidx.compose.ui.graphics.Color
    init(ranges: [Int], color: androidx.compose.ui.graphics.Color) { self.ranges = ranges; self.color = color }

    override func filter(_ text: AnnotatedString) -> TransformedText {
        let builder = AnnotatedString.Builder(text)
        for index in stride(from: 0, to: ranges.count - 1, by: 2) {
            let start = ranges[index]
            let end = ranges[index + 1]
            if start >= 0 && end <= text.length && end > start + 1 {
                builder.addStyle(SpanStyle(color: color, fontWeight: FontWeight.Medium), start: start, end: end)
            }
        }
        return TransformedText(builder.toAnnotatedString(), OffsetMapping.Identity)
    }
}
#endif
