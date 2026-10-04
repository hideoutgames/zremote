import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Named light/dark colors resolve in the current view's appearance on both platforms.
enum Palette {
    static let background = Color("PaletteBackground", bundle: .module)
    static let surface = Color("PaletteSurface", bundle: .module)
    static let raised = Color("PaletteRaised", bundle: .module)
    static let text = Color("PaletteText", bundle: .module)
    static let line = text.opacity(0.09)
    static let secondary = Color("PaletteSecondary", bundle: .module)
    static let addition = Color("PaletteAddition", bundle: .module)
    static let deletion = Color("PaletteDeletion", bundle: .module)
    // Zeron iOS violet. Keep rare purple accents on one light/dark token.
    static let accent = Color("PaletteAccent", bundle: .module)
    static let merged = accent
    static let usageFill = Color("PaletteUsageFill", bundle: .module)
    static let usageTrack = Color("PaletteUsageTrack", bundle: .module)
    // Stable path-hash order from Zeron iOS Design/Palette.swift.
    static let projectTones: [Color] = [
        Color("ProjectSlate", bundle: .module), Color("ProjectBlue", bundle: .module),
        Color("ProjectViolet", bundle: .module), Color("ProjectRose", bundle: .module),
        Color("ProjectAmber", bundle: .module), Color("ProjectEmerald", bundle: .module),
        Color("ProjectTeal", bundle: .module), Color("ProjectOrange", bundle: .module),
    ]
}

extension View {
    func appSwitch() -> some View {
        self.tint(Palette.secondary)
            #if os(iOS)
            .toggleStyle(.switch)
            #endif
    }
}

struct CircleControl: View {
    let symbol: String
    let label: String
    var action: @MainActor () -> Void

    @ViewBuilder var body: some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            NativeGlassButton(image: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)),
                              accessibilityLabel: label, accessibilityValue: "", enabled: true, size: 46, action: action)
                .frame(width: 46, height: 46)
        } else { standardButton }
        #else
        standardButton
        #endif
    }

    private var standardButton: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .regular))
                .frame(width: 46, height: 46)
                .background(Palette.raised, in: Circle())
                .overlay(Circle().strokeBorder(Palette.line, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.text)
        .accessibilityLabel(label)
    }
}

struct PrimaryButton: View {
    let title: String
    var symbol: String? = nil
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                if let symbol { Image(systemName: symbol) }
                Text(title).fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .foregroundStyle(Palette.background)
            .background(Palette.text, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let detail: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 28, weight: .light))
            Text(title).font(.title3.weight(.medium)).foregroundStyle(Palette.text)
            Text(detail).font(.subheadline).multilineTextAlignment(.center)
                .frame(maxWidth: 300)
        }
        .foregroundStyle(Palette.secondary)
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ActivityGlyph: View {
    var mini = false
    var animating = true
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State var illuminated = false

    var body: some View {
        #if os(iOS)
        NativeActivityGlyph(mini: mini, reduceMotion: reduceMotion || !animating)
            .frame(width: mini ? 12 : 14, height: mini ? 12 : 14)
            .accessibilityLabel("Agent working")
        #else
        HStack(spacing: 2.5) {
            ForEach(0..<3) { index in
                Capsule().frame(width: 2, height: 11)
                    .scaleEffect(x: 1, y: reduceMotion || !animating ? CGFloat(0.55 + Double(index) * 0.18) : illuminated ? 1 : 0.4)
                    .animation(reduceMotion || !animating ? nil : .easeInOut(duration: 0.8)
                        .repeatForever(autoreverses: true).delay(Double(index) * 0.14), value: illuminated)
            }
        }
        .foregroundStyle(Palette.secondary)
        .frame(width: 14, height: 16)
        .task(id: reduceMotion || !animating) { illuminated = !reduceMotion && animating }
        .accessibilityLabel("Agent working")
        #endif
    }
}
