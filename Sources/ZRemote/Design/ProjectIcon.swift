import SwiftUI
import ZRemoteCore
#if os(iOS)
import CoreText
import UIKit
#endif

/// Zeron iOS ProjectTile, placed inline with the session title in ZRemote.
/// Geometry, tones and bundled typeface: docs/BUILD.md and THIRD_PARTY_NOTICES.md.
struct ProjectIcon: View {
    let monogram: ProjectMonogram
    let side: CGFloat
    @Environment(\.colorScheme) var colorScheme
    #if os(iOS)
    @Environment(\.displayScale) var displayScale
    #endif

    private var tone: Color { Palette.projectTones[monogram.colorIndex] }

    var body: some View {
        Group {
            #if os(iOS)
            Image(uiImage: NativeProjectTile.image(letter: monogram.letter,
                tone: UIColor(tone).resolvedColor(with: UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)),
                side: side, scale: displayScale))
                .renderingMode(.original)
            #else
            Text(monogram.letter)
                .font(.custom("GeistMono-Medium", fixedSize: 9 * side / 13))
                .foregroundStyle(tone.opacity(0.85))
                .frame(width: side, height: side)
                .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: 3 * side / 13, style: .circular))
            #endif
        }
        .frame(width: side, height: side)
        .fixedSize()
        .accessibilityHidden(true)
    }
}

#if os(iOS)
/// Keeps the official rasterizer's capital-height centering and circular corners.
@MainActor private enum NativeProjectTile {
    private static let baseFont: UIFont = {
        guard let url = Bundle.module.url(forResource: "GeistMono-Medium", withExtension: "ttf"),
              let provider = CGDataProvider(url: url as CFURL), let font = CGFont(provider)
        else { return UIFont.monospacedSystemFont(ofSize: 9, weight: .medium) }
        return CTFontCreateWithGraphicsFont(font, 9, nil, nil) as UIFont
    }()

    static func image(letter: String, tone: UIColor, side: CGFloat, scale: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale > 0 ? scale : 3
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            let k = side / 13
            tone.withAlphaComponent(0.08).setFill()
            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: side, height: side), cornerRadius: 3 * k).fill()
            let font = baseFont.withSize(9 * k)
            let text = NSAttributedString(string: letter, attributes: [.font: font, .foregroundColor: tone.withAlphaComponent(0.85)])
            text.draw(at: CGPoint(x: (side - text.size().width) / 2, y: side / 2 - (font.ascender - font.capHeight / 2)))
        }.withRenderingMode(.alwaysOriginal)
    }
}
#endif
