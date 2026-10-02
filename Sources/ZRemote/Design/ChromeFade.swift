import SwiftUI

/// The scroll content remains visible beneath the chrome. Only the lower edge
/// gains a black scrim so lines disappear gently behind the input surface.
struct ChromeFade: View {
    let edge: VerticalEdge
    @Environment(\.colorScheme) var colorScheme

    private var lowerColor: Color { colorScheme == .dark ? .black : Palette.background }

    var body: some View {
        GeometryReader { geometry in
            let topFadeStart = max(0, 1 - 24 / max(1, geometry.size.height))
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                    .mask(LinearGradient(stops: edge == .top
                        ? [.init(color: .black, location: 0), .init(color: .black, location: topFadeStart), .init(color: .clear, location: 1)]
                        : [.init(color: .clear, location: 0), .init(color: .black, location: 0.55), .init(color: .black, location: 1)],
                        startPoint: .top, endPoint: .bottom))
                if edge == .bottom {
                    LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: lowerColor.opacity(0.8), location: 0.5), .init(color: lowerColor, location: 1)],
                                   startPoint: .top, endPoint: .bottom)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
