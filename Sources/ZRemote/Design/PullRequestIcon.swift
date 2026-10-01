import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
#endif

/// Zeron's pull-request mark, shared by the session list, chat and native menus.
/// Adapted from Zeron's MIT-licensed Design/StatusGlyph.swift (PRIcon).
struct PullRequestIcon: View {
    let request: PullRequest?
    var size: CGFloat = 18

    var body: some View {
        PullRequestGlyph().stroke(style: StrokeStyle(lineWidth: max(1, size / 16), lineCap: .round, lineJoin: .round))
            .foregroundStyle(request.map { PullRequestPresentationState($0).color } ?? Palette.secondary)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    #if os(iOS)
    @MainActor static func menuImage(for request: PullRequest?, size: CGFloat = 18, colorScheme: ColorScheme) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return renderer.image { context in
            let cg = context.cgContext
            let traits = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
            let color = request.map { PullRequestPresentationState($0).color } ?? Palette.secondary
            cg.setStrokeColor(UIColor(color).resolvedColor(with: traits).cgColor)
            cg.setLineWidth(max(1, size / 16))
            cg.setLineCap(.round); cg.setLineJoin(.round)
            cg.addPath(PullRequestGlyph().path(in: CGRect(x: 0, y: 0, width: size, height: size)).cgPath)
            cg.strokePath()
        }.withRenderingMode(.alwaysOriginal)
    }
    #endif
}

struct PullRequestGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        var path = Path()
        for center in [point(6, 5), point(6, 19), point(18, 19)] {
            path.addEllipse(in: CGRect(x: center.x - 2.25 * scale, y: center.y - 2.25 * scale,
                                      width: 4.5 * scale, height: 4.5 * scale))
        }
        path.move(to: point(6, 7.25)); path.addLine(to: point(6, 16.75))
        path.move(to: point(15, 5)); path.addLine(to: point(15.75, 5))
        path.addQuadCurve(to: point(18, 7.25), control: point(18, 5))
        path.addLine(to: point(18, 16.75))
        path.move(to: point(12.75, 7.75)); path.addLine(to: point(15.25, 5)); path.addLine(to: point(12.75, 2.25))
        return path
    }
}

extension PullRequestPresentationState {
    var color: Color {
        switch self {
        case .draft, .unknown: return Palette.secondary
        case .open: return Palette.addition
        case .merged: return Palette.merged
        case .closed: return Palette.deletion
        }
    }
}
