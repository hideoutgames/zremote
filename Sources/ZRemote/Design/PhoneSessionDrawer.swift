import SwiftUI
import ZRemoteCore

/// Independent implementation of the requested sliding-main-page interaction.
/// SwiftSideDrawer's source has no published license, so none is incorporated.
struct PhoneSessionDrawer<MenuContent: View, MainContent: View>: View {
    @Binding var isOpen: Bool
    let safeAreaInsets: EdgeInsets
    let gesturesEnabled: Bool
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.layoutDirection) var layoutDirection
    @State var dragOriginOpen: Bool?
    @State var translation: CGFloat = 0
    @State var menuInteractionsEnabled = false
    let menu: () -> MenuContent
    let content: () -> MainContent

    init(isOpen: Binding<Bool>, safeAreaInsets: EdgeInsets, gesturesEnabled: Bool,
         @ViewBuilder menu: @escaping () -> MenuContent, @ViewBuilder content: @escaping () -> MainContent) {
        _isOpen = isOpen
        self.safeAreaInsets = safeAreaInsets
        self.gesturesEnabled = gesturesEnabled
        self.menu = menu
        self.content = content
    }

    private var rightToLeft: Bool { layoutDirection == .rightToLeft }
    private var settling: Animation? { reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.88) }

    var body: some View {
        // Only this phone stage ignores safe areas. The root measures their live
        // values, including the keyboard, and each page restores that padding
        // inside its full-window frame, before clipping or horizontal movement.
        GeometryReader { geometry in
            let width = geometry.size.width
            let distance = width * 0.9
            let offset = min(distance, max(0, ((dragOriginOpen ?? isOpen) ? distance : 0)
                                              + translation * (rightToLeft ? -1 : 1)))
            let reveal = distance > 0 ? Double(offset / distance) : 0
            ZStack(alignment: .leading) {
                Palette.background
                menu()
                    .padding(safeAreaInsets)
                    .frame(width: distance, height: geometry.size.height)
                    #if os(Android)
                    .animation(.linear(duration: 0), value: offset)
                    #endif
                    .overlay {
                        Color.black.opacity(0.1 * (1 - reveal))
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    .allowsHitTesting(isOpen && menuInteractionsEnabled)
                    .accessibilityHidden(!isOpen)
                content()
                    .allowsHitTesting(!isOpen)
                    .accessibilityHidden(isOpen)
                    .padding(safeAreaInsets)
                    .frame(width: width, height: geometry.size.height)
                    .background(Palette.background)
                    #if os(Android)
                    // Skip treats nil as an absent override. Keep descendants
                    // still while the native page transform moves their surface.
                    .animation(.linear(duration: 0), value: offset)
                    #endif
                    #if !os(iOS)
                    .overlay {
                        Color.black.opacity(0.025 * reveal)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    #endif
                    .overlay {
                        if isOpen {
                            Color.clear.contentShape(Rectangle())
                                .onTapGesture { settle(false) }
                                .accessibilityLabel("Close sessions")
                                .accessibilityAddTraits(.isButton)
                        }
                    }
                    #if os(iOS)
                    .modifier(DrawerPageMotion(offset: offset, distance: distance, rightToLeft: rightToLeft))
                    #else
                    // Skip animates its native rounded shape; custom Shape
                    // animatableData is not forwarded by the pinned bridge.
                    .clipShape(RoundedRectangle(cornerRadius: offset > 0 ? 56 : 0, style: .continuous))
                    .shadow(color: .black.opacity(distance > 0 ? 0.2 * offset / distance : 0), radius: 18)
                    .offset(x: offset * (rightToLeft ? -1 : 1))
                    #endif
            }
            .frame(width: width, height: geometry.size.height)
            .clipped()
            // Native recognizers decide intent before taking a touch. There is
            // no invisible edge view blocking buttons, selection or scrolling.
            #if os(iOS)
            .background(NativeDrawerPan(enabled: gesturesEnabled,
                onBegin: { x, dx, dy in begin(x: x, dx: dx, dy: dy, width: width) },
                onChange: track,
                onEnd: { dx, velocity in finish(dx: dx, velocity: velocity, distance: distance) },
                onCancel: cancel))
            #elseif os(Android)
            .composeModifier {
                DrawerPanModifier(enabled: gesturesEnabled,
                    onBegin: { x, dx, dy in begin(x: x, dx: dx, dy: dy, width: width) },
                    onChange: track,
                    onEnd: { dx, velocity in finish(dx: dx, velocity: velocity, distance: distance) },
                    onCancel: cancel)
            }
            #endif
            .animation(settling, value: isOpen)
            .onChange(of: geometry.size) { _, _ in cancel() }
        }
        .ignoresSafeArea()
        .task(id: [isOpen, reduceMotion]) {
            menuInteractionsEnabled = false
            guard isOpen else { return }
            if reduceMotion {
                await Task.yield()
            } else {
                do { try await Task.sleep(nanoseconds: 280_000_000) }
                catch { return }
            }
            guard !Task.isCancelled, isOpen else { return }
            menuInteractionsEnabled = true
        }
        .onChange(of: isOpen) { _, _ in cancel() }
        .onChange(of: gesturesEnabled) { _, enabled in if !enabled { cancel() } }
        .onChange(of: layoutDirection) { _, _ in cancel() }
        .onDisappear { cancel() }
    }

    private func begin(x: Double, dx: Double, dy: Double, width: CGFloat) -> Bool {
        guard gesturesEnabled, dragOriginOpen == nil,
              DrawerGestureRules.canBegin(isOpen: isOpen, startX: x, width: Double(width),
                translationX: dx, translationY: dy, rightToLeft: rightToLeft) else { return false }
        dragOriginOpen = isOpen
        track(dx)
        return true
    }

    private func track(_ dx: Double) {
        guard dragOriginOpen != nil, dx.isFinite else { return }
        withTransaction(Transaction(animation: nil)) {
            translation = CGFloat(dx)
        }
    }

    private func finish(dx: Double, velocity: Double, distance: CGFloat) {
        guard let origin = dragOriginOpen else { return }
        settle(DrawerGestureRules.targetIsOpen(wasOpen: origin, translationX: dx, velocityX: velocity,
                                               distance: Double(distance), rightToLeft: rightToLeft))
    }

    private func settle(_ open: Bool) {
        withAnimation(settling) {
            translation = 0
            dragOriginOpen = nil
            isOpen = open
        }
    }

    private func cancel() {
        guard dragOriginOpen != nil else { return }
        withAnimation(settling) {
            translation = 0
            dragOriginOpen = nil
        }
    }
}

#if os(iOS)
nonisolated struct DrawerPageMotion: AnimatableModifier {
    var offset: CGFloat
    let distance: CGFloat
    let rightToLeft: Bool

    var animatableData: CGFloat {
        get { offset }
        set { offset = newValue }
    }

    func body(content: Content) -> some View {
        let reveal = distance > 0 ? Double(min(1, max(0, offset / distance))) : 0
        content
            .transaction { $0.animation = nil }
            .overlay {
                Color.black.opacity(0.025 * reveal)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .compositingGroup()
            .clipShape(RoundedRectangle(cornerRadius: abs(offset) > 0.01 ? 56 : 0, style: .continuous))
            .shadow(color: .black.opacity(0.2 * reveal), radius: 18)
            .offset(x: offset * (rightToLeft ? -1 : 1))
    }
}
#endif
