import SwiftUI
import ZRemoteCore

struct TranscriptScrollTracking: ViewModifier {
    @Binding var state: TranscriptScrollState
    let viewportHeight: CGFloat
    let request: Int
    let animated: Bool
    let reduceMotion: Bool

    @ViewBuilder func body(content: Content) -> some View {
        #if os(iOS)
        if #available(iOS 18.0, *) {
            content.modifier(NativeTranscriptScrollTracking(state: $state, request: request,
                                                           animated: animated, reduceMotion: reduceMotion))
        } else {
            content.modifier(LegacyTranscriptScrollTracking(state: $state, viewportHeight: viewportHeight))
                .defaultScrollAnchor(.bottom)
        }
        #elseif os(Android)
        content.modifier(LegacyTranscriptScrollTracking(state: $state, viewportHeight: viewportHeight))
        #else
        content.modifier(LegacyTranscriptScrollTracking(state: $state, viewportHeight: viewportHeight))
            .defaultScrollAnchor(.bottom)
        #endif
    }
}

struct LegacyTranscriptScrollTracking: ViewModifier {
    @Binding var state: TranscriptScrollState
    let viewportHeight: CGFloat

    func body(content: Content) -> some View {
        content
            .onPreferenceChange(TranscriptTailPosition.self) { position in
                guard let position else { return }
                state.update(atBottom: position <= viewportHeight + 24)
            }
            .simultaneousGesture(DragGesture(minimumDistance: 4)
                .onChanged { value in
                    if abs(value.translation.height) > abs(value.translation.width) {
                        state.beginUserScroll()
                    }
                }
                .onEnded { _ in state.endUserScroll() })
    }
}

#if os(iOS)
@available(iOS 18.0, *)
private struct TranscriptScrollGeometry: Equatable {
    let atBottom: Bool
    let contentHeight: CGFloat
    let viewportHeight: CGFloat
    let bottomInset: CGFloat

    init(_ geometry: ScrollGeometry) {
        atBottom = TranscriptScrollState.isAtBottom(contentHeight: geometry.contentSize.height,
                                                   bottomInset: geometry.contentInsets.bottom,
                                                   visibleBottom: geometry.visibleRect.maxY)
        contentHeight = geometry.contentSize.height
        viewportHeight = geometry.containerSize.height
        bottomInset = geometry.contentInsets.bottom
    }
}

@available(iOS 18.0, *)
struct NativeTranscriptScrollTracking: ViewModifier {
    @Binding var state: TranscriptScrollState
    @State var position = ScrollPosition(edge: .bottom)
    let request: Int
    let animated: Bool
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        content
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.bottom, for: .alignment)
            .scrollPosition($position)
            .onScrollGeometryChange(for: TranscriptScrollGeometry.self, of: { TranscriptScrollGeometry($0) }) { old, new in
                state.update(atBottom: new.atBottom)
                if state.shouldFollow,
                   old.contentHeight != new.contentHeight || old.viewportHeight != new.viewportHeight || old.bottomInset != new.bottomInset {
                    position.scrollTo(edge: .bottom)
                }
            }
            .onScrollPhaseChange { _, phase, context in
                switch phase {
                case .tracking, .interacting:
                    state.beginUserScroll()
                case .idle:
                    state.update(atBottom: TranscriptScrollGeometry(context.geometry).atBottom)
                    state.endUserScroll()
                    if state.jumpPending { position.scrollTo(edge: .bottom) }
                default:
                    break
                }
            }
            .onChange(of: request) { _, _ in
                withAnimation(animated && !reduceMotion ? .easeOut(duration: 0.2) : nil) {
                    position.scrollTo(edge: .bottom)
                }
            }
    }
}
#endif
