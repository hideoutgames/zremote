import SwiftUI
import ZRemoteCore

/// Revealed behind the list by native overscroll. The wallpaper renderer uses
/// the full scene's coordinates, so pulling farther exposes more of the image
/// without stretching it to fit this small strip.
struct SessionRefreshRecess: View {
    @Bindable var model: AppModel
    var refreshing: Bool
    @State var animateDots = false
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Palette.background
                if model.sessionsVisible, model.preferences.backgroundEnabled,
                   let data = model.preferences.backgroundImageData {
                    ComposerBackground(data: data, effect: model.preferences.backgroundEffect,
                                       fullHeight: model.preferences.backgroundFullHeight, fadeEndY: nil)
                    Color.black.opacity(colorScheme == .dark ? 0.12 : 0.07)
                } else {
                    Color.black.opacity(colorScheme == .dark ? 0.10 : 0.03)
                }

                // Shadows live inside the reveal, not on top of the list or
                // throbber. The two edges make the surface feel recessed.
                VStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(0.09), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: min(10, geometry.size.height / 2))
                    Spacer(minLength: 0)
                    LinearGradient(colors: [.clear, .black.opacity(0.07)], startPoint: .top, endPoint: .bottom)
                        .frame(height: min(8, geometry.size.height / 2))
                }
                if geometry.size.height > 16 {
                    ActivityGlyph(animating: refreshing && animateDots)
                        .scaleEffect(reduceMotion ? 1 : refreshing ? 1 : min(1.8, max(0.45, geometry.size.height / 60)))
                        .opacity(min(1, geometry.size.height / 36))
                        .animation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.68), value: refreshing)
                }
            }
        }
        .clipped()
        .task(id: refreshing) {
            animateDots = false
            guard refreshing else { return }
            if !reduceMotion { try? await Task.sleep(for: .milliseconds(160)) }
            if !Task.isCancelled { animateDots = true }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
