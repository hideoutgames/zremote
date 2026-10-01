#if os(iOS)
import SwiftUI
import UIKit

/// Attach to the ScrollView's content background so UIKit keeps ownership of
/// scrolling and refresh gestures. The session strip supplies the visible glyph.
struct NativeSessionRefresh: UIViewRepresentable {
    let hapticsEnabled: Bool
    let action: @MainActor () async -> Void

    func makeCoordinator() -> Coordinator { Coordinator(hapticsEnabled: hapticsEnabled, action: action) }

    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: AttachmentView, context: Context) {
        context.coordinator.hapticsEnabled = hapticsEnabled
        context.coordinator.action = action
        context.coordinator.attach(from: view)
    }

    static func dismantleUIView(_ view: AttachmentView, coordinator: Coordinator) {
        view.coordinator = nil
        coordinator.detach()
    }

    @MainActor final class AttachmentView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            coordinator?.attach(from: self)
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(from: self)
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            coordinator?.attach(from: self)
        }
    }

    @MainActor final class Coordinator: NSObject {
        var hapticsEnabled: Bool
        var action: @MainActor () async -> Void
        private weak var scrollView: UIScrollView?
        private var control: RefreshControl?
        private var originalAlwaysBounceVertical = false
        private var refreshTask: Task<Void, Never>?
        private var generation = 0

        init(hapticsEnabled: Bool, action: @escaping @MainActor () async -> Void) {
            self.hapticsEnabled = hapticsEnabled
            self.action = action
        }

        func attach(from view: UIView) {
            guard view.window != nil else { detach(); return }
            var ancestor = view.superview
            while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
            guard let scroll = ancestor as? UIScrollView else { detach(); return }
            if scroll === scrollView, scroll.refreshControl === control { return }
            detach()
            // Never replace a control installed by another owner.
            guard scroll.refreshControl == nil else { return }
            let refresh = RefreshControl()
            refresh.tintColor = .clear
            refresh.isAccessibilityElement = true
            refresh.accessibilityLabel = "Refresh sessions"
            refresh.accessibilityTraits = .button
            refresh.addTarget(self, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
            scrollView = scroll
            control = refresh
            originalAlwaysBounceVertical = scroll.alwaysBounceVertical
            scroll.alwaysBounceVertical = true
            scroll.refreshControl = refresh
        }

        func detach() {
            generation &+= 1
            refreshTask?.cancel()
            refreshTask = nil
            if let control {
                control.removeTarget(self, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
                control.endRefreshing()
                if let scrollView, scrollView.refreshControl === control {
                    scrollView.refreshControl = nil
                    if scrollView.alwaysBounceVertical { scrollView.alwaysBounceVertical = originalAlwaysBounceVertical }
                }
            }
            control = nil
            scrollView = nil
        }

        @objc private func refresh(_ sender: UIRefreshControl) {
            guard sender === control, scrollView?.refreshControl === sender, refreshTask == nil else { return }
            AppHaptics.refreshTriggered(enabled: hapticsEnabled, in: sender)
            generation &+= 1
            let epoch = generation
            let perform = action
            sender.accessibilityValue = "Refreshing"
            refreshTask = Task { @MainActor [weak self, weak sender] in
                guard !Task.isCancelled else { return }
                await perform()
                guard let self, let sender, self.generation == epoch, self.control === sender else { return }
                self.refreshTask = nil
                sender.accessibilityValue = nil
                if self.scrollView?.refreshControl === sender { sender.endRefreshing() }
            }
        }
    }

    @MainActor final class RefreshControl: UIRefreshControl {
        override func accessibilityActivate() -> Bool {
            guard isEnabled else { return false }
            if !isRefreshing {
                beginRefreshing()
                sendActions(for: .valueChanged)
            }
            return true
        }
    }
}
#endif
