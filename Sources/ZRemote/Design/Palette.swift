import SwiftUI

/// The quiet charcoal palette sampled from the supplied product references.
enum Palette {
    static let background = Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)
    static let surface = Color(red: 32 / 255, green: 32 / 255, blue: 32 / 255)
    static let raised = Color(red: 39 / 255, green: 39 / 255, blue: 39 / 255)
    static let line = Color.white.opacity(0.09)
    static let text = Color(white: 0.98)
    static let secondary = Color(white: 0.70)
    static let addition = Color(red: 48 / 255, green: 209 / 255, blue: 88 / 255)
    static let deletion = Color(red: 1, green: 69 / 255, blue: 58 / 255)
}

struct CircleControl: View {
    let symbol: String
    let label: String
    var action: () -> Void

    var body: some View {
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var illuminated = false
    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<3) { index in
                Capsule().frame(width: 2, height: 11)
                    .scaleEffect(x: 1, y: reduceMotion ? CGFloat(0.55 + Double(index) * 0.18) : illuminated ? 1 : 0.4)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.8)
                        .repeatForever(autoreverses: true).delay(Double(index) * 0.14), value: illuminated)
            }
        }
        .foregroundStyle(Palette.secondary)
        .frame(width: 14, height: 16)
        .task(id: reduceMotion) { illuminated = !reduceMotion }
        .accessibilityLabel("Agent working")
    }
}
