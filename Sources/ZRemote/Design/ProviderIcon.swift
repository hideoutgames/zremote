import SwiftUI

/// Original Zeron provider marks, bundled locally for both live and test mode.
/// Provenance: docs/PROVIDER_MARKS.md and Resources/Licenses/Zeron-MIT.txt.
struct ProviderIcon: View {
    let providerID: String
    var size: CGFloat = 17
    var muted = false
    var tint: Color? = nil

    private var asset: String? {
        switch providerID {
        case "claude-code", "mock": "claude"
        case "codex": "openai"
        case "cursor", "devin", "grok", "hermes", "pi", "opencode", "antigravity": providerID
        default: nil
        }
    }

    var body: some View {
        Group {
            if let asset {
                Image("provider-" + asset, bundle: .module)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
            } else {
                Image(systemName: "cpu")
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(tint ?? (muted ? Palette.secondary : providerID == "claude-code" || providerID == "mock"
            ? Color(red: 217 / 255, green: 119 / 255, blue: 87 / 255) : Palette.text))
        .accessibilityHidden(true)
    }
}
