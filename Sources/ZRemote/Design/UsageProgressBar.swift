import SwiftUI

struct UsageProgressBar: View {
    let remaining: Double
    var warning = false
    @Environment(\.colorScheme) var colorScheme

    private var fraction: Double { remaining.isFinite ? min(1, max(0, remaining)) : 0 }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.usageTrack)
                Capsule().fill(warning ? Color.orange : Palette.usageFill).frame(width: geometry.size.width * fraction)
            }
            // Keep the requested white fill visible on light Settings surfaces.
            .overlay(Capsule().strokeBorder(Palette.usageTrack, lineWidth: colorScheme == .light ? 0.5 : 0))
        }
        .frame(height: 4)
        .accessibilityLabel("Usage remaining")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
    }
}
