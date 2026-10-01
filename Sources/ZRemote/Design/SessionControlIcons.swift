import SwiftUI

/// Preserve Apple's symbols while supplying the two marks missing from Skip's
/// pinned system-symbol table. Android paths inherit the control's foreground.
struct SessionFilterIcon: View {
    var body: some View {
        #if os(Android)
        SessionSliderGlyph().stroke(style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            .frame(width: 19, height: 19)
        #else
        Image(systemName: "slider.horizontal.3")
        #endif
    }
}

struct CheckoutBranchIcon: View {
    @ScaledMetric(relativeTo: .subheadline) private var size: CGFloat = 17

    var body: some View {
        #if os(Android)
        CheckoutBranchGlyph().stroke(style: StrokeStyle(lineWidth: max(1, size / 12), lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
        #else
        Image(systemName: "arrow.triangle.branch")
        #endif
    }
}

#if os(Android)
private struct SessionSliderGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        var path = Path()
        for (x, y): (CGFloat, CGFloat) in [(8, 5), (16, 12), (10, 19)] {
            path.move(to: point(3, y)); path.addLine(to: point(x - 2, y))
            path.move(to: point(x + 2, y)); path.addLine(to: point(21, y))
            let center = point(x, y)
            path.addEllipse(in: CGRect(x: center.x - 2 * scale, y: center.y - 2 * scale,
                                      width: 4 * scale, height: 4 * scale))
        }
        return path
    }
}

private struct CheckoutBranchGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        var path = Path()
        path.move(to: point(7, 21)); path.addLine(to: point(7, 3))
        path.move(to: point(4, 6)); path.addLine(to: point(7, 3)); path.addLine(to: point(10, 6))
        path.move(to: point(7, 15))
        path.addCurve(to: point(18, 7), control1: point(7, 9), control2: point(18, 13))
        path.addLine(to: point(18, 3))
        path.move(to: point(15, 6)); path.addLine(to: point(18, 3)); path.addLine(to: point(21, 6))
        return path
    }
}
#endif
