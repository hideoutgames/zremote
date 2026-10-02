#if os(iOS)
import SwiftUI
import UIKit

struct NativeKeyboardDismiss: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        context.coordinator.attach(view)
    }

    static func dismantleUIView(_ view: ProbeView, coordinator: Coordinator) {
        view.coordinator = nil
        coordinator.detach()
    }

    @MainActor final class ProbeView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(self)
        }
    }

    @MainActor final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var probe: UIView?
        private weak var window: UIWindow?
        private var tap: UITapGestureRecognizer?

        func attach(_ view: UIView) {
            guard let nextWindow = view.window else { detach(); return }
            probe = view
            guard window !== nextWindow || tap == nil else { return }
            detach()
            probe = view
            window = nextWindow
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard(_:)))
            recognizer.cancelsTouchesInView = false
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            recognizer.delegate = self
            tap = recognizer
            nextWindow.addGestureRecognizer(recognizer)
        }

        func detach() {
            if let tap {
                tap.delegate = nil
                tap.removeTarget(self, action: #selector(dismissKeyboard(_:)))
                tap.view?.removeGestureRecognizer(tap)
            }
            tap = nil
            probe = nil
            window = nil
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard recognizer === tap, let probe, probe.window === window,
                  let window, window.bounds.contains(touch.location(in: window)), let target = touch.view,
                  target.window === window else { return false }
            var ancestor: UIView? = target
            while let view = ancestor {
                if view is UITextView { return false }
                if let control = view as? UIControl, !isPassiveNavigationContent(control) { return false }
                ancestor = view.superview
            }
            return true
        }

        private func isPassiveNavigationContent(_ control: UIControl) -> Bool {
            guard !(control is UIButton), !(control is UITextField),
                  control.allTargets.isEmpty, (control.gestureRecognizers ?? []).isEmpty,
                  !control.accessibilityTraits.contains(.button) else { return false }
            var ancestor = control.superview
            while let view = ancestor {
                if view is UINavigationBar { return true }
                ancestor = view.superview
            }
            return false
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldRequireFailureOf other: UIGestureRecognizer) -> Bool {
            recognizer === tap && !(other is UIPanGestureRecognizer)
        }

        @objc private func dismissKeyboard(_ sender: UITapGestureRecognizer) {
            guard sender === tap, sender.state == .ended else { return }
            window?.endEditing(true)
        }
    }
}
#endif
