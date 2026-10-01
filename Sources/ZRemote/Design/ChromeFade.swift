import SwiftUI

/// The scroll content remains visible beneath the chrome. Only the lower edge
/// gains a black scrim so lines disappear gently behind the input surface.
struct ChromeFade: View {
    let edge: VerticalEdge

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
                .mask(LinearGradient(stops: edge == .top
                    ? [.init(color: .black, location: 0), .init(color: .black, location: 0.45), .init(color: .clear, location: 1)]
                    : [.init(color: .clear, location: 0), .init(color: .black, location: 0.55), .init(color: .black, location: 1)],
                    startPoint: .top, endPoint: .bottom))
            if edge == .bottom {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black.opacity(0.8), location: 0.5), .init(color: .black, location: 1)],
                               startPoint: .top, endPoint: .bottom)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
