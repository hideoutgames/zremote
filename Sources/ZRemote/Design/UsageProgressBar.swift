import SwiftUI

struct UsageProgressBar: View {
    let remaining: Double
    var warning = false

    private var fraction: Double { remaining.isFinite ? min(1, max(0, remaining)) : 0 }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.usageTrack)
                Capsule().fill(warning ? Color.orange.opacity(0.85) : Palette.usageFill)
                    .frame(width: geometry.size.width * fraction)
            }
        }
        .frame(height: 4)
        .accessibilityLabel("Usage remaining")
        .accessibilityValue("\(Int((fraction * 100).rounded())) percent")
    }
}
