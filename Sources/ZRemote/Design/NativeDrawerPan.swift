#if os(iOS)
import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// A window recognizer scoped to this noninteractive background probe. Native
/// controls keep their touches; the drawer supplies only its direction policy.
struct NativeDrawerPan: UIViewRepresentable {
    let enabled: Bool
    let onBegin: @MainActor (Double, Double, Double) -> Bool
    let onChange: @MainActor (Double) -> Void
    let onEnd: @MainActor (Double, Double) -> Void
    let onCancel: @MainActor () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.attach(view)
    }

    static func dismantleUIView(_ view: ProbeView, coordinator: Coordinator) {
        view.coordinator = nil
        coordinator.detach()
    }

    @MainActor final class ProbeView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            coordinator?.attach(self)
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(self)
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            coordinator?.attach(self)
        }
    }

    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var parent: NativeDrawerPan
        private weak var probe: UIView?
        private weak var window: UIWindow?
        private weak var touchView: UIView?
        private var pan: DrawerRecognizer?
        private var startX: CGFloat?
        private var beginEvaluated = false
        private var accepted = false
        private var attempt = 0

        init(_ parent: NativeDrawerPan) { self.parent = parent }

        func attach(_ view: UIView) {
            guard let nextWindow = view.window else { detach(); return }
            probe = view
            if window !== nextWindow || pan == nil {
                detach()
                probe = view
                window = nextWindow
                let recognizer = DrawerRecognizer(target: self, action: #selector(handlePan(_:)))
                recognizer.minimumNumberOfTouches = 1
                recognizer.maximumNumberOfTouches = 1
                recognizer.delaysTouchesBegan = false
                recognizer.delaysTouchesEnded = false
                recognizer.cancelsTouchesInView = true
                recognizer.delegate = self
                recognizer.didReset = { [weak self] in self?.resetAttempt() }
                pan = recognizer
                nextWindow.addGestureRecognizer(recognizer)
            }
            if !parent.enabled { cancelAccepted(deferred: true) }
            if pan?.isEnabled != parent.enabled { pan?.isEnabled = parent.enabled }
        }

        func detach() {
            cancelAccepted(deferred: true)
            if let pan {
                pan.didReset = nil
                pan.delegate = nil
                pan.removeTarget(self, action: #selector(handlePan(_:)))
                pan.view?.removeGestureRecognizer(pan)
            }
            pan = nil
            probe = nil
            window = nil
            resetAttempt()
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard recognizer === pan, parent.enabled, let probe, probe.window === window, !hasPresentedController(window?.rootViewController),
                  probe.bounds.contains(touch.location(in: probe)), touch.tapCount <= 1,
                  let target = touch.view, !excluded(target) else { return false }
            if startX == nil {
                startX = touch.location(in: probe).x
                touchView = target
            }
            return true
        }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard recognizer === pan, let pan, parent.enabled, let probe, probe.window === window, !hasPresentedController(window?.rootViewController),
                  pan.numberOfTouches == 1, let startX, let touchView, !excluded(touchView) else { return false }
            if beginEvaluated { return accepted }
            beginEvaluated = true
            let delta = pan.translation(in: probe)
            accepted = parent.onBegin(Double(startX), Double(delta.x), Double(delta.y))
            if accepted { attempt &+= 1 }
            return accepted
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            guard recognizer === pan, parent.enabled, let target = touchView,
                  !excluded(target), let view = other.view,
                  target === view || target.isDescendant(of: view),
                  !(other is UILongPressGestureRecognizer) else { return false }
            if let scroll = view as? UIScrollView, other === scroll.panGestureRecognizer { return false }
            return true
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            guard recognizer === pan, parent.enabled, let scroll = other.view as? UIScrollView,
                  other === scroll.panGestureRecognizer, scroll.isScrollEnabled,
                  !scrollsHorizontally(scroll), let target = touchView,
                  target === scroll || target.isDescendant(of: scroll) else { return false }
            // The touched vertical scroll waits only for our direction decision.
            // A horizontal drawer drag cannot also arm pull-to-refresh.
            return scroll.alwaysBounceVertical || scroll.contentSize.height + scroll.adjustedContentInset.top
                + scroll.adjustedContentInset.bottom > scroll.bounds.height + 1
        }

        @objc private func handlePan(_ sender: UIPanGestureRecognizer) {
            guard sender === pan, accepted, let probe else { return }
            guard parent.enabled, probe.window === window, sender.numberOfTouches <= 1,
                  !hasPresentedController(window?.rootViewController) else {
                cancelAccepted()
                return
            }
            let delta = Double(sender.translation(in: probe).x)
            switch sender.state {
            case .began, .changed:
                parent.onChange(delta)
            case .ended:
                accepted = false
                parent.onEnd(delta, Double(sender.velocity(in: probe).x))
            case .cancelled, .failed:
                cancelAccepted()
            default: break
            }
        }

        private func excluded(_ target: UIView) -> Bool {
            var ancestor: UIView? = target
            while let view = ancestor {
                if view is UIControl || view is UITextField { return true }
                if let text = view as? UITextView, text.isEditable || text.selectedRange.length > 0 { return true }
                if let scroll = view as? UIScrollView, scrollsHorizontally(scroll) { return true }
                if view.gestureRecognizers?.contains(where: {
                    $0 is UILongPressGestureRecognizer && ($0.state == .began || $0.state == .changed)
                }) == true { return true }
                ancestor = view.superview
            }
            return false
        }

        private func scrollsHorizontally(_ scroll: UIScrollView) -> Bool {
            scroll.isScrollEnabled && scroll.contentSize.width > scroll.bounds.width + 1
        }

        private func hasPresentedController(_ controller: UIViewController?) -> Bool {
            guard let controller else { return false }
            if controller.presentedViewController != nil { return true }
            return controller.children.contains { hasPresentedController($0) }
        }

        private func cancelAccepted(deferred: Bool = false) {
            guard accepted else { return }
            accepted = false
            let cancel = parent.onCancel
            if deferred {
                // Representable updates/teardown must not synchronously mutate
                // SwiftUI state. Keep cleanup alive for one actor turn, while a
                // new accepted gesture invalidates this older cancellation.
                let cancelledAttempt = attempt
                Task { @MainActor [self] in
                    guard attempt == cancelledAttempt else { return }
                    cancel()
                }
            } else { cancel() }
        }

        private func resetAttempt() {
            // UIKit can fail after shouldBegin without sending a target action.
            cancelAccepted()
            startX = nil
            touchView = nil
            beginEvaluated = false
        }
    }

    @MainActor final class DrawerRecognizer: UIPanGestureRecognizer {
        var didReset: (@MainActor () -> Void)?

        override func reset() {
            super.reset()
            didReset?()
        }
    }
}
#endif
