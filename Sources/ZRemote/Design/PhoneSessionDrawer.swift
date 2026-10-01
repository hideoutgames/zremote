import SwiftUI

/// Independent implementation of the requested sliding-main-page interaction.
/// SwiftSideDrawer's source has no published license, so none is incorporated.
struct PhoneSessionDrawer<MenuContent: View, MainContent: View>: View {
    @Binding var isOpen: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @GestureState private var translation: CGFloat = 0
    let menu: () -> MenuContent
    let content: () -> MainContent

    init(isOpen: Binding<Bool>, @ViewBuilder menu: @escaping () -> MenuContent, @ViewBuilder content: @escaping () -> MainContent) {
        _isOpen = isOpen; self.menu = menu; self.content = content
    }

    var body: some View {
        GeometryReader { geometry in
            let distance = max(0, geometry.size.width - 52)
            let direction: CGFloat = layoutDirection == .rightToLeft ? -1 : 1
            let offset = min(distance, max(0, (isOpen ? distance : 0) + translation * direction))
            ZStack(alignment: .leading) {
                menu()
                    .frame(width: distance)
                    .accessibilityHidden(!isOpen)
                content()
                    .accessibilityHidden(isOpen)
                    .background(Palette.background)
                    .clipShape(RoundedRectangle(cornerRadius: offset > 0 ? 28 : 0, style: .continuous))
                    .overlay {
                        if isOpen {
                            Color.black.opacity(0.10)
                                .contentShape(Rectangle())
                                .onTapGesture { toggle(false) }
                                .accessibilityLabel("Close sessions")
                                .accessibilityAddTraits(.isButton)
                        }
                    }
                    .overlay(alignment: .leading) {
                        if !isOpen {
                            Color.clear.frame(width: 22)
                                .contentShape(Rectangle())
                                .gesture(pan(distance: distance, direction: direction))
                                .accessibilityHidden(true)
                        }
                    }
                    .offset(x: offset * direction)
                    #if os(Android)
                    // Optional<Gesture> is not bridged by the pinned Skip version.
                    .simultaneousGesture(pan(distance: distance, direction: direction), isEnabled: isOpen)
                    #else
                    .simultaneousGesture(isOpen ? pan(distance: distance, direction: direction) : nil)
                    #endif
            }
            .clipped()
        }
    }

    private func toggle(_ value: Bool) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.88)) { isOpen = value }
    }
    private func pan(distance: CGFloat, direction: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($translation) { value, state, _ in
                if abs(value.translation.width) > abs(value.translation.height) { state = value.translation.width }
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let projected = (isOpen ? distance : 0) + value.predictedEndTranslation.width * direction
                toggle(projected > distance * 0.4)
            }
    }
}
