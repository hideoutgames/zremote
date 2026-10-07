#if os(iOS)
import SwiftUI
import UIKit

/// Lazy rows can revise contentSize after ScrollViewReader resolves its target.
struct TranscriptScrollAnchor: UIViewRepresentable {
    let request: Int
    let following: Bool

    func makeUIView(context: Context) -> AnchorView { AnchorView() }

    func updateUIView(_ view: AnchorView, context: Context) {
        view.following = following
        if view.request != request {
            view.request = request
            view.chasingTail = request > 0
        }
        view.scheduleScroll()
    }

    static func dismantleUIView(_ view: AnchorView, coordinator: ()) {
        view.observation = nil
        view.chasingTail = false
    }

    final class AnchorView: UIView {
        var request = 0
        var following = false
        var chasingTail = true
        var scheduled = false
        weak var scrollView: UIScrollView?
        var observation: NSKeyValueObservation?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            scheduleScroll()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            scheduleScroll()
        }

        func scheduleScroll() {
            guard !scheduled else { return }
            scheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.scheduled = false
                self.attach()
                guard self.following, self.chasingTail, let scroll = self.scrollView,
                      !scroll.isTracking, !scroll.isDragging else { return }
                let bottom = max(-scroll.adjustedContentInset.top,
                                 scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
                if abs(scroll.contentOffset.y - bottom) > 0.5 {
                    scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: bottom), animated: false)
                }
            }
        }

        func attach() {
            guard scrollView == nil else { return }
            var ancestor = superview
            while let view = ancestor {
                if let scroll = view as? UIScrollView {
                    scrollView = scroll
                    observation = scroll.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
                        Task { @MainActor in self?.scheduleScroll() }
                    }
                    return
                }
                ancestor = view.superview
            }
        }
    }
}
#endif
