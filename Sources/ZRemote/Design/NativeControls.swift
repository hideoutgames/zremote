import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

enum NativeClipboard {
    @MainActor static func copy(_ text: String) {
        #if os(iOS) || os(Android)
        // SkipFuseUI forwards this API to Android's native ClipboardManager.
        UIPasteboard.general.string = text
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

extension View {
    /// Native Haptic Touch on iOS; Skip's Compose menu provides a LongPress
    /// haptic when it opens on Android. Let the platform own gesture timing,
    /// accessibility and feedback rather than adding a second gesture/haptic.
    func nativeContextMenu<Items: View>(@ViewBuilder _ items: () -> Items) -> some View {
        contextMenu(menuItems: items)
    }

    @ViewBuilder func nativeGlassControl(interactive: Bool = true) -> some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: Capsule())
        } else {
            background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.line))
        }
        #else
        background(Palette.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.line))
        #endif
    }
}

struct ComposerStatusButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.75 : 1)
    }
}
