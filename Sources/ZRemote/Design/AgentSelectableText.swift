import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Transcript text needs range selection handles, not only a whole-message Copy
/// action. UITextView owns selection and links; the transcript owns scrolling.
struct AgentSelectableText: View {
    let value: String
    var markdown = false
    var code = false
    var secondary = false
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.sizeCategory) var sizeCategory

    var body: some View {
        #if os(iOS)
        AgentTextView(value: value, markdown: markdown, code: code, secondary: secondary,
                      colorScheme: colorScheme, sizeCategory: sizeCategory)
        #else
        SelectableText(value, markdown: markdown)
        #endif
    }
}

#if os(iOS)
private struct AgentTextView: UIViewRepresentable {
    let value: String
    let markdown: Bool
    let code: Bool
    let secondary: Bool
    let colorScheme: ColorScheme
    let sizeCategory: ContentSizeCategory

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .clear
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        // Resolve against the SwiftUI appearance, including an in-app override.
        view.overrideUserInterfaceStyle = colorScheme == .dark ? .dark : .light
        let content = attributedText(traits: view.traitCollection)
        view.tintColor = UIColor(Palette.text)
        view.linkTextAttributes = [.foregroundColor: UIColor(Palette.text), .underlineStyle: NSUnderlineStyle.single.rawValue]
        guard view.attributedText?.isEqual(to: content) != true else { return }
        let selection = view.selectedRange
        view.attributedText = content
        // Streaming appends must not reset the user's active selection.
        if selection.location != NSNotFound, NSMaxRange(selection) <= content.length {
            view.selectedRange = selection
        }
        view.invalidateIntrinsicContentSize()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let text = uiView.attributedText else { return .zero }
        let width: CGFloat
        if let proposed = proposal.width, proposed.isFinite {
            width = max(1, proposed)
        } else {
            // Horizontal code scrolling proposes no width. Measure its longest
            // line instead of wrapping it to the phone's viewport.
            width = max(1, ceil(text.boundingRect(with: CGSize(width: CGFloat.greatestFiniteMagnitude,
                height: CGFloat.greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).width))
        }
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(fitted.height))
    }

    private func attributedText(traits: UITraitCollection) -> NSAttributedString {
        let textStyle: UIFont.TextStyle = code ? .footnote : secondary ? .subheadline : .body
        let base = UIFont.preferredFont(forTextStyle: textStyle, compatibleWith: traits)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = code ? 4 : 5
        let color = UIColor(secondary ? Palette.secondary : Palette.text)
        let font = code ? UIFont.monospacedSystemFont(ofSize: base.pointSize, weight: .regular) : base
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
        guard markdown, let parsed = try? AttributedString(markdown: value,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return NSAttributedString(string: value, attributes: attributes)
        }
        let output = NSMutableAttributedString(string: "")
        for run in parsed.runs {
            var styled = attributes
            var runFont = font
            if let intent = run.inlinePresentationIntent {
                if intent.contains(.code) { runFont = UIFont.monospacedSystemFont(ofSize: base.pointSize, weight: .regular) }
                var traits = runFont.fontDescriptor.symbolicTraits
                if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
                if intent.contains(.emphasized) { traits.insert(.traitItalic) }
                if let descriptor = runFont.fontDescriptor.withSymbolicTraits(traits) {
                    runFont = UIFont(descriptor: descriptor, size: base.pointSize)
                }
                if intent.contains(.strikethrough) { styled[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            }
            styled[.font] = runFont
            if let link = run.link { styled[.link] = link }
            output.append(NSAttributedString(string: String(parsed[run.range].characters), attributes: styled))
        }
        return output
    }
}
#endif
