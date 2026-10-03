#if os(iOS)
import SwiftUI
import UIKit
import ZRemoteCore

/// Attach from stable ScrollView content so UIKit keeps ownership of
/// scrolling and refresh gestures. The session strip supplies the visible glyph.
struct NativeSessionRefresh: UIViewRepresentable {
    let hapticsEnabled: Bool
    let onRevealChange: @MainActor (CGFloat) -> Void
    let action: @MainActor () async -> Void

    func makeCoordinator() -> Coordinator { Coordinator(hapticsEnabled: hapticsEnabled, onRevealChange: onRevealChange, action: action) }

    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView()
        view.isUserInteractionEnabled = false
        view.accessibilityElementsHidden = true
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: AttachmentView, context: Context) {
        context.coordinator.hapticsEnabled = hapticsEnabled
        context.coordinator.onRevealChange = onRevealChange
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
        var onRevealChange: @MainActor (CGFloat) -> Void
        var action: @MainActor () async -> Void
        private weak var scrollView: UIScrollView?
        private var control: RefreshControl?
        private var originalAlwaysBounceVertical = false
        private var refreshTask: Task<Void, Never>?
        private var feedbackDeadline: ContinuousClock.Instant?
        private var offsetObservation: NSKeyValueObservation?
        private var insetObservation: NSKeyValueObservation?
        private var revealTask: Task<Void, Never>?
        private var reattachTask: Task<Void, Never>?
        private var geometry = SessionRefreshGeometry(restingTopInset: 0)
        private var pendingReveal: CGFloat = 0
        private var lastReveal: CGFloat = -1
        private var generation = 0
        private let feedback = UIImpactFeedbackGenerator(style: .light)

        init(hapticsEnabled: Bool, onRevealChange: @escaping @MainActor (CGFloat) -> Void,
             action: @escaping @MainActor () async -> Void) {
            self.hapticsEnabled = hapticsEnabled
            self.onRevealChange = onRevealChange
            self.action = action
        }

        func attach(from view: UIView, retry: Bool = true) {
            guard view.window != nil else { detach(); return }
            var ancestor = view.superview
            while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
            guard let scroll = ancestor as? UIScrollView else {
                detach()
                if retry {
                    let epoch = generation
                    reattachTask = Task { @MainActor [weak self, weak view] in
                        await Task.yield()
                        guard let self, let view, !Task.isCancelled, self.generation == epoch else { return }
                        self.reattachTask = nil
                        self.attach(from: view, retry: false)
                    }
                }
                return
            }
            if scroll === scrollView, scroll.refreshControl === control {
                // SwiftUI may update bounce behavior after initial attachment.
                scroll.alwaysBounceVertical = true
                sampleReveal()
                return
            }
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
            scroll.panGestureRecognizer.addTarget(self, action: #selector(Coordinator.dragChanged(_:)))
            originalAlwaysBounceVertical = scroll.alwaysBounceVertical
            geometry = SessionRefreshGeometry(restingTopInset: Double(scroll.adjustedContentInset.top),
                                              systemTopInset: Double(scroll.adjustedContentInset.top - scroll.contentInset.top))
            scroll.alwaysBounceVertical = true
            scroll.refreshControl = refresh
            let epoch = generation
            offsetObservation = scroll.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == epoch else { return }
                    self.sampleReveal()
                }
            }
            insetObservation = scroll.observe(\.adjustedContentInset, options: [.new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == epoch else { return }
                    self.sampleReveal()
                }
            }
            sampleReveal()
        }

        func detach() {
            generation &+= 1
            reattachTask?.cancel(); reattachTask = nil
            revealTask?.cancel(); revealTask = nil
            offsetObservation?.invalidate(); offsetObservation = nil
            insetObservation?.invalidate(); insetObservation = nil
            refreshTask?.cancel()
            refreshTask = nil
            feedbackDeadline = nil
            scrollView?.panGestureRecognizer.removeTarget(self, action: #selector(Coordinator.dragChanged(_:)))
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
            publishReveal(0)
        }

        private func sampleReveal() {
            guard let scrollView, let control, scrollView.refreshControl === control else { return }
            let pan = scrollView.panGestureRecognizer.state
            let dragging = pan == .began || pan == .changed
            var height = geometry.reveal(contentOffsetY: Double(scrollView.contentOffset.y),
                                         adjustedTopInset: Double(scrollView.adjustedContentInset.top),
                                         systemTopInset: Double(scrollView.adjustedContentInset.top - scrollView.contentInset.top),
                                         dragging: dragging, refreshing: control.isRefreshing || refreshTask != nil)
            if refreshTask != nil, !dragging { height = max(height, 60) }
            publishReveal(CGFloat(height))
        }

        private func publishReveal(_ height: CGFloat) {
            pendingReveal = height
            guard revealTask == nil else { return }
            let epoch = generation
            // KVO, layout and representable updates may run within a SwiftUI
            // update. Publish on the next actor turn, coalescing native frames.
            revealTask = Task { @MainActor [weak self] in
                await Task.yield()
                guard let self, !Task.isCancelled, self.generation == epoch else { return }
                self.revealTask = nil
                let value = self.pendingReveal
                guard value != self.lastReveal else { return }
                self.lastReveal = value
                self.onRevealChange(value)
            }
        }

        @objc private func refresh(_ sender: UIRefreshControl) {
            guard sender === control, scrollView?.refreshControl === sender, refreshTask == nil else { return }
            AppHaptics.refreshTriggered(enabled: hapticsEnabled, feedback: feedback)
            let epoch = generation
            let perform = action
            let gestureState = scrollView?.panGestureRecognizer.state
            feedbackDeadline = gestureState == .began || gestureState == .changed
                ? nil : ContinuousClock.now.advanced(by: .milliseconds(900))
            sender.accessibilityValue = "Refreshing"
            refreshTask = Task { @MainActor [weak self, weak sender] in
                guard !Task.isCancelled else { return }
                await perform()
                do {
                    while !Task.isCancelled {
                        guard let self, self.generation == epoch else { return }
                        if let deadline = self.feedbackDeadline {
                            if ContinuousClock.now >= deadline { break }
                            try await Task.sleep(until: deadline, clock: .continuous)
                        } else {
                            try await Task.sleep(for: .milliseconds(16))
                        }
                    }
                }
                catch { return }
                guard !Task.isCancelled, let self, let sender,
                      self.generation == epoch, self.control === sender else { return }
                self.refreshTask = nil
                self.feedbackDeadline = nil
                sender.accessibilityValue = nil
                if self.scrollView?.refreshControl === sender { sender.endRefreshing() }
                self.sampleReveal()
            }
            sampleReveal()
        }

        @objc private func dragChanged(_ gesture: UIPanGestureRecognizer) {
            if gesture.state == .began, hapticsEnabled { feedback.prepare() }
            guard refreshTask != nil else { return }
            switch gesture.state {
            case .began, .changed: feedbackDeadline = nil
            case .ended, .cancelled, .failed:
                feedbackDeadline = ContinuousClock.now.advanced(by: .milliseconds(900))
            default: break
            }
            sampleReveal()
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
