import SwiftUI
import ZRemoteCore

/// Revealed behind the list by native overscroll. The wallpaper renderer uses
/// the full scene's coordinates, so pulling farther exposes more of the image
/// without stretching it to fit this small strip.
struct SessionRefreshRecess: View {
    @Bindable var model: AppModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Palette.background
                if model.sessionsVisible, model.preferences.backgroundEnabled,
                   let data = model.preferences.backgroundImageData {
                    ComposerBackground(data: data, effect: model.preferences.backgroundEffect)
                    Color.black.opacity(colorScheme == .dark ? 0.18 : 0.10)
                } else {
                    Color.black.opacity(colorScheme == .dark ? 0.16 : 0.045)
                }

                // Shadows live inside the reveal, not on top of the list or
                // throbber. The two edges make the surface feel recessed.
                VStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(0.18), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: min(10, geometry.size.height / 2))
                    Spacer(minLength: 0)
                    LinearGradient(colors: [.clear, .black.opacity(0.14)], startPoint: .top, endPoint: .bottom)
                        .frame(height: min(8, geometry.size.height / 2))
                }
                if geometry.size.height > 16 {
                    ActivityGlyph()
                }
            }
        }
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
