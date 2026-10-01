import SwiftUI

/// The composer and queued-message delivery share the same send control.
struct ComposerActionButton: View {
    var stopping = false
    var busy = false
    var enabled = true
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().tint(Palette.background) }
                else { Image(systemName: stopping ? "stop.fill" : "arrow.up").font(.system(size: 18, weight: .semibold)) }
            }
            .frame(width: 44, height: 44)
            .foregroundStyle(enabled ? Palette.background : Palette.secondary)
            .background(enabled ? Palette.text : Palette.raised, in: Circle())
        }
        .buttonStyle(.plain).disabled(!enabled || busy)
        .accessibilityLabel(label)
    }
}
