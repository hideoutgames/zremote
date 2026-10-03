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
                        #if os(iOS)
                        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
                            let phase = timeline.date.timeIntervalSinceReferenceDate
                                .truncatingRemainder(dividingBy: 3.4) / 3.4
                            LinearGradient(stops: [
                                .init(color: .clear, location: 1.14 / 9),
                                .init(color: Palette.text, location: 1.5 / 9),
                                .init(color: .clear, location: 1.86 / 9),
                                .init(color: .clear, location: 4.14 / 9),
                                .init(color: Palette.text, location: 4.5 / 9),
                                .init(color: .clear, location: 4.86 / 9),
                                .init(color: .clear, location: 7.14 / 9),
                                .init(color: Palette.text, location: 7.5 / 9),
                                .init(color: .clear, location: 7.86 / 9)
                            ], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 9)
                            .offset(x: geometry.size.width * (-6 + phase * 6))
                        }
                        #else
                        LinearGradient(colors: [.clear, Palette.text.opacity(0.8), .clear],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: geometry.size.width * 0.7)
                            .offset(x: animating ? geometry.size.width : -geometry.size.width * 0.7)
                            .animation(.linear(duration: 1.7).repeatForever(autoreverses: false), value: animating)
                        #endif
                    }
                    .mask(Text(text))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
            #if !os(iOS)
            .task(id: reduceMotion) { animating = !reduceMotion }
            #endif
    }
}
