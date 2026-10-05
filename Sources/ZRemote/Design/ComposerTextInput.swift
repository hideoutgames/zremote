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
    var maximumHeight: CGFloat? = nil
    @FocusState var androidFocused: Bool

    var body: some View {
        #if os(iOS)
        NativeComposerEditor(text: $text, cursor: $cursor, isFocused: $isFocused, isComposing: $isComposing,
                             selectionRequest: selectionRequest, maximumHeight: maximumHeight)
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
                ComposerTokenModifier(ranges: ComposerReferenceText(text).references.flatMap { [$0.sourceRange.location, NSMaxRange($0.sourceRange)] },
                                      labels: ComposerReferenceText(text).references.map(\.label),
                                      kinds: ComposerReferenceText(text).references.map { $0.kind.referenceColorIndex },
                                      colors: [ComposerTokenKind.command.referenceColor, ComposerTokenKind.skill.referenceColor, ComposerTokenKind.file.referenceColor],
                                      cursor: cursor, selectionRequest: selectionRequest, normalize: normalizeChange,
                                      onSelection: { cursor = $0 }, onComposition: { isComposing = $0 })
            }
            #endif
            .onChange(of: androidFocused) { _, value in isFocused = value }
            .onChange(of: isFocused) { _, value in androidFocused = value }
            .onChange(of: text) { _, value in if value.isEmpty { isComposing = false } }
        #endif
    }

    /// Primitive values keep the native Swift/Compose bridge independent of
    /// Foundation ranges. The result carries text and the two UTF-16 offsets.
    private func normalizeChange(_ before: String, _ after: String, _ positions: [Int], _ composing: Bool) -> [String] {
        let start = positions[0], end = positions[1], oldStart = positions[2], oldEnd = positions[3]
        guard !composing else { return [after, String(start), String(end)] }
        let document = ComposerReferenceText(before)
        let previous = NSRange(location: min(oldStart, oldEnd), length: abs(oldEnd - oldStart))
        if before != after {
            let edit = document.editing(after, selection: previous, inSource: true)
            return [edit.text, String(edit.cursorUTF16), String(edit.cursorUTF16)]
        }
        let selection = document.selection(NSRange(location: min(start, end), length: abs(end - start)), previous: previous, inSource: true)
        return start <= end ? [after, String(selection.location), String(NSMaxRange(selection))] : [after, String(NSMaxRange(selection)), String(selection.location)]
    }
}

#if os(iOS)
struct NativeComposerEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var cursor: Int
    @Binding var isFocused: Bool
    @Binding var isComposing: Bool
    let selectionRequest: Int
    let maximumHeight: CGFloat?

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
        let enabled = context.environment.isEnabled
        view.isEditable = enabled
        view.isSelectable = enabled
        // An intentional external reset (for example Send) must discard the
        // old preedit. Ordinary editor updates already match the binding and
        // leave marked text untouched, preserving CJK input and dictation.
        if context.coordinator.document.source != text {
            view.unmarkText()
            context.coordinator.document = ComposerReferenceText(text)
            view.text = context.coordinator.document.text
            context.coordinator.reportCompositionAfterReplacement(view)
        }
        if view.markedTextRange == nil {
            context.coordinator.decorate(view)
            if context.coordinator.lastSelectionRequest != selectionRequest {
                view.selectedRange = NSRange(location: context.coordinator.document.displayOffset(cursor), length: 0)
                context.coordinator.lastSelectionRequest = selectionRequest
            }
            context.coordinator.previousSelection = view.selectedRange
        }
        if enabled && isFocused && !view.isFirstResponder { view.becomeFirstResponder() }
        if (!enabled || !isFocused) && view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let line = UIFont.preferredFont(forTextStyle: .body).lineHeight
        let desired = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let maximum = min(line * 8 + 8, max(line + 8, maximumHeight ?? .greatestFiniteMagnitude))
        uiView.isScrollEnabled = desired > maximum
        return CGSize(width: width, height: min(max(line + 8, desired), maximum))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NativeComposerEditor
        var updating = false
        var lastSelectionRequest = -1
        var document = ComposerReferenceText("")
        var previousSelection = NSRange(location: 0, length: 0)
        init(_ parent: NativeComposerEditor) { self.parent = parent }

        func textViewDidChange(_ view: UITextView) {
            guard !updating else { return }
            let edit = document.editing(view.text, selection: previousSelection)
            document = ComposerReferenceText(edit.text)
            updating = true
            if view.markedTextRange == nil, view.text != document.text {
                view.textStorage.setAttributedString(NSAttributedString(string: document.text))
                view.selectedRange = NSRange(location: document.displayOffset(edit.cursorUTF16), length: 0)
            }
            parent.text = document.source
            parent.cursor = document.sourceOffset(NSMaxRange(view.selectedRange))
            parent.isComposing = view.markedTextRange != nil
            if view.markedTextRange == nil { decorate(view) }
            previousSelection = view.selectedRange
            updating = false
            view.invalidateIntrinsicContentSize()
        }
        func textViewDidChangeSelection(_ view: UITextView) {
            guard !updating else { return }
            guard view.text == document.text else { return }
            if view.markedTextRange == nil {
                let selection = document.selection(view.selectedRange, previous: previousSelection)
                if selection != view.selectedRange {
                    updating = true; view.selectedRange = selection; updating = false
                }
            }
            previousSelection = view.selectedRange
            parent.cursor = document.sourceOffset(NSMaxRange(view.selectedRange))
            parent.isComposing = view.markedTextRange != nil
        }
        func textViewDidBeginEditing(_ view: UITextView) { if !updating { parent.isFocused = true } }
        func textViewDidEndEditing(_ view: UITextView) { if !updating { parent.isFocused = false } }

        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            guard !updating, view.markedTextRange == nil else { return true }
            let overlaps = document.references.contains { reference in
                range.length > 0 ? NSIntersectionRange(range, reference.displayRange).length > 0 :
                    range.location > reference.displayRange.location && range.location < NSMaxRange(reference.displayRange)
            }
            guard overlaps else { return true }
            let edit = document.replacing(range, with: replacement)
            restore(edit.text, selection: NSRange(location: edit.cursorUTF16, length: 0), in: view)
            return false
        }

        private func restore(_ source: String, selection: NSRange, in view: UITextView) {
            let oldSource = document.source
            let oldStart = document.sourceOffset(view.selectedRange.location)
            let oldSelection = NSRange(location: oldStart, length: document.sourceOffset(NSMaxRange(view.selectedRange)) - oldStart)
            view.undoManager?.registerUndo(withTarget: self) { [weak view] target in
                if let view { target.restore(oldSource, selection: oldSelection, in: view) }
            }
            updating = true
            document = ComposerReferenceText(source)
            view.textStorage.setAttributedString(NSAttributedString(string: document.text))
            let start = document.displayOffset(selection.location)
            view.selectedRange = NSRange(location: start, length: document.displayOffset(NSMaxRange(selection)) - start)
            decorate(view)
            previousSelection = view.selectedRange
            parent.text = source; parent.cursor = NSMaxRange(selection); parent.isComposing = false
            updating = false
            view.invalidateIntrinsicContentSize()
        }

        func reportCompositionAfterReplacement(_ view: UITextView) {
            // Publish outside updateUIView, and do not overwrite a newer preedit.
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, view.markedTextRange == nil, view.text == self.document.text else { return }
                self.parent.isComposing = false
            }
        }

        func decorate(_ view: UITextView) {
            let whole = NSRange(location: 0, length: (view.text as NSString).length)
            let selection = view.selectedRange
            let storage = view.textStorage
            storage.beginEditing()
            storage.setAttributes([.font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.label], range: whole)
            for reference in document.references {
                let color = UIColor(reference.kind.referenceColor)
                storage.addAttributes([.foregroundColor: color, .backgroundColor: color.withAlphaComponent(0.10)], range: reference.displayRange)
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
    let labels: [String]
    let kinds: [Int]
    let colors: [Color]
    let cursor: Int
    let selectionRequest: Int
    let normalize: (String, String, [Int], Bool) -> [String]
    let onSelection: (Int) -> Void
    let onComposition: (Bool) -> Void

    init(ranges: [Int], labels: [String], kinds: [Int], colors: [Color], cursor: Int, selectionRequest: Int, normalize: @escaping (String, String, [Int], Bool) -> [String], onSelection: @escaping (Int) -> Void, onComposition: @escaping (Bool) -> Void) {
        self.ranges = ranges
        self.labels = labels
        self.kinds = kinds
        self.colors = colors
        self.cursor = cursor
        self.selectionRequest = selectionRequest
        self.normalize = normalize
        self.onSelection = onSelection
        self.onComposition = onComposition
    }

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
            var resolved: [androidx.compose.ui.graphics.Color] = []
            for color in colors {
                resolved.append(color.asComposeColor())
            }
            let transformation = labels.isEmpty || ranges.count < 2
                ? VisualTransformation.None
                : referenceVisualTransformation(ranges: ranges, labels: labels, kinds: kinds, colors: resolved)
            return options.copy(onValueChange: { value in
                let corrected = normalize(options.value.text, value.text, [value.selection.start, value.selection.end,
                                          options.value.selection.start, options.value.selection.end], value.composition != nil)
                let start = Int(corrected[1]) ?? value.selection.start
                let end = Int(corrected[2]) ?? value.selection.end
                let next = value.copy(text: corrected[0], selection: TextRange(start, end),
                                      composition: corrected[0] == value.text ? value.composition : nil)
                options.onValueChange(next)
                onSelection(end)
                onComposition(next.composition != nil)
            }, visualTransformation: transformation, maxLines: options.maxLines)
        }
    }
}

struct ReferenceSpan {
    let sourceStart: Int
    let sourceEnd: Int
    let displayStart: Int
    let displayEnd: Int
}

func referenceAnnotatedString(source: String, ranges: [Int], labels: [String], kinds: [Int], colors: [androidx.compose.ui.graphics.Color]) -> AnnotatedString {
    let builder = AnnotatedString.Builder()
    let count = min(labels.count, ranges.count / 2)
    var cursor = 0
    for index in 0..<count {
        let start = ranges[index * 2]
        let end = ranges[index * 2 + 1]
        if start < cursor || end > source.length || end < start { continue }
        if start > cursor { builder.append(source.substring(cursor, start)) }
        let label = labels[index]
        let color = index < kinds.count && kinds[index] >= 0 && kinds[index] < colors.count ? colors[kinds[index]] : nil
        if let color {
            builder.pushStyle(SpanStyle(color: color, fontWeight: FontWeight.Medium, background: color.copy(alpha: 0.10)))
            builder.append(label)
            builder.pop()
        } else {
            builder.append(label)
        }
        cursor = end
    }
    if cursor < source.length { builder.append(source.substring(cursor)) }
    return builder.toAnnotatedString()
}

final class ReferenceOffsetMapping: OffsetMapping {
    let spans: [ReferenceSpan]
    let displayLength: Int
    let sourceLength: Int
    init(spans: [ReferenceSpan], displayLength: Int, sourceLength: Int) {
        self.spans = spans
        self.displayLength = displayLength
        self.sourceLength = sourceLength
    }
    func originalToTransformed(offset: Int) -> Int {
        let clamped = min(max(0, offset), sourceLength)
        var delta = 0
        for span in spans {
            if clamped <= span.sourceStart { break }
            if clamped < span.sourceEnd { return span.displayEnd }
            delta += (span.sourceEnd - span.sourceStart) - (span.displayEnd - span.displayStart)
        }
        return min(max(0, clamped - delta), displayLength)
    }
    func transformedToOriginal(offset: Int) -> Int {
        let clamped = min(max(0, offset), displayLength)
        var delta = 0
        for span in spans {
            if clamped <= span.displayStart { break }
            if clamped < span.displayEnd {
                let mid = span.displayStart + (span.displayEnd - span.displayStart) / 2
                return clamped < mid ? span.sourceStart : span.sourceEnd
            }
            delta += (span.sourceEnd - span.sourceStart) - (span.displayEnd - span.displayStart)
        }
        return min(max(0, clamped + delta), sourceLength)
    }
}

func referenceVisualTransformation(ranges: [Int], labels: [String], kinds: [Int], colors: [androidx.compose.ui.graphics.Color]) -> VisualTransformation {
    VisualTransformation { text in
        let builder = AnnotatedString.Builder()
        var spans: [ReferenceSpan] = []
        let count = min(labels.count, ranges.count / 2)
        var cursor = 0
        for index in 0..<count {
            let start = ranges[index * 2]
            let end = ranges[index * 2 + 1]
            if start < cursor || end > text.length || end < start { continue }
            if start > cursor { builder.append(text.subSequence(cursor, start)) }
            let displayStart = builder.length
            let label = labels[index]
            let color = index < kinds.count && kinds[index] >= 0 && kinds[index] < colors.count ? colors[kinds[index]] : nil
            if let color {
                builder.pushStyle(SpanStyle(color: color, fontWeight: FontWeight.Medium, background: color.copy(alpha: 0.10)))
                builder.append(label)
                builder.pop()
            } else {
                builder.append(label)
            }
            spans.append(ReferenceSpan(sourceStart: start, sourceEnd: end, displayStart: displayStart, displayEnd: builder.length))
            cursor = end
        }
        if cursor < text.length { builder.append(text.subSequence(cursor, text.length)) }
        let mapping = ReferenceOffsetMapping(spans: spans, displayLength: builder.length, sourceLength: text.length)
        return TransformedText(builder.toAnnotatedString(), mapping)
    }
}

#endif
