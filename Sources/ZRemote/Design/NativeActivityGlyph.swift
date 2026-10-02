import SwiftUI
#if os(iOS)
import UIKit

struct NativeActivityGlyph: UIViewRepresentable {
    let mini: Bool
    let reduceMotion: Bool

    func makeUIView(context: Context) -> NativeStatusGlyph {
        NativeStatusGlyph(mini: mini, reduceMotion: reduceMotion)
    }

    func updateUIView(_ view: NativeStatusGlyph, context: Context) {
        view.overrideUserInterfaceStyle = context.environment.colorScheme == .dark ? .dark : .light
        view.reduceMotion = reduceMotion
    }
}

// Adapted from Zeron's MIT-licensed iOS StatusGlyph; see docs/PROVIDER_MARKS.md.
final class NativeStatusGlyph: UIView {
    private let mini: Bool
    private let cells: [CALayer]
    var reduceMotion: Bool {
        didSet { if reduceMotion != oldValue { restyle() } }
    }

    private static let ring = [[0, 1], [5, 2], [4, 3]]
    private static let glyphTints = [
        tint(0x7965EC, 0xABA1F9),
        tint(0x5B43E8, 0x8B7CF6),
        tint(0x4332AC, 0x7266CA),
    ]
    private static let trailerTints = [
        tint(0xB6D3EF, 0xB6D3EF),
        tint(0xEDB185, 0xEDB185),
        tint(0xF888A0, 0xF888A0),
    ]

    init(mini: Bool, reduceMotion: Bool) {
        self.mini = mini
        self.reduceMotion = reduceMotion
        cells = (0..<(mini ? 6 : 9)).map { _ in CALayer() }
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        cells.forEach { layer.addSublayer($0) }
        restyle()
    }

    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        CGSize(width: mini ? 12 : 14, height: mini ? 12 : 14)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let columns = mini ? 2 : 3
        let d: CGFloat = 3.5, gap: CGFloat = mini ? 1.5 : 1.75
        let ox = bounds.midX - (d * CGFloat(columns) + gap * CGFloat(columns - 1)) / 2
        let oy = bounds.midY - (d * 3 + gap * 2) / 2
        for (i, cell) in cells.enumerated() {
            cell.frame = CGRect(x: ox + CGFloat(i % columns) * (d + gap),
                                y: oy + CGFloat(i / columns) * (d + gap), width: d, height: d)
            cell.cornerRadius = d / 2
        }
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        restyle()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        restyle()
    }

    private func restyle() {
        let columns = mini ? 2 : 3
        for (i, cell) in cells.enumerated() {
            let row = i / columns, col = i % columns
            let tint = mini ? Self.glyphTints[row] : Self.trailerTints[row]
            cell.backgroundColor = tint.resolvedColor(with: traitCollection).cgColor
            let phase = mini ? Double(Self.ring[row][col]) / 6 : Double(2 - row + abs(col - 1)) / 4
            cell.removeAllAnimations()
            cell.opacity = Float(Self.opacity(phase))
            guard !reduceMotion, window != nil else { continue }
            let animation = CAKeyframeAnimation(keyPath: "opacity")
            animation.values = [1, 0.1, 0.1, 1]
            animation.keyTimes = [0, 0.45, 0.92, 1]
            animation.duration = 0.75
            animation.repeatCount = .infinity
            animation.timeOffset = phase * 0.75
            animation.isRemovedOnCompletion = false
            cell.add(animation, forKey: "spin")
        }
    }

    private static func opacity(_ t: Double) -> Double {
        let t = t - floor(t)
        if t < 0.45 { return 1 + (0.1 - 1) * t / 0.45 }
        if t < 0.92 { return 0.1 }
        return 0.1 + (1 - 0.1) * (t - 0.92) / 0.08
    }

    private static func tint(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xff) / 255,
                           green: CGFloat((hex >> 8) & 0xff) / 255,
                           blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        }
    }
}
#endif
