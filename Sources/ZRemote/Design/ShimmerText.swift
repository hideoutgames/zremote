import SwiftUI

/// Quiet monochrome activity text. Reduced Motion keeps the readable base label.
struct ShimmerText: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State var animating = false

    var body: some View {
        Text(text)
            .foregroundStyle(Palette.secondary)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geometry in
                        LinearGradient(colors: [.clear, Palette.text.opacity(0.8), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.7)
                            .offset(x: animating ? geometry.size.width : -geometry.size.width * 0.7)
                            .animation(.linear(duration: 1.7).repeatForever(autoreverses: false), value: animating)
                    }
                    .mask(Text(text))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            .task(id: reduceMotion) { animating = !reduceMotion }
    }
}
