#if os(iOS)
import SwiftUI
import UIKit

struct AnchoredModelPopover<Content: View>: UIViewRepresentable {
    @Binding var isPresented: Bool
    let height: CGFloat
    @ViewBuilder var content: () -> Content

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(view)
    }

    static func dismantleUIView(_ view: UIView, coordinator: Coordinator) {
        coordinator.controller?.dismiss(animated: false)
        coordinator.controller = nil
    }

    final class Coordinator: NSObject, UIPopoverPresentationControllerDelegate {
        var parent: AnchoredModelPopover
        var controller: ModelPopoverController<Content>?
        var scheduled = false

        init(parent: AnchoredModelPopover) { self.parent = parent }

        func update(_ anchor: UIView) {
            if let controller {
                if !parent.isPresented {
                    self.controller = nil
                    controller.dismiss(animated: true)
                } else {
                    controller.setContent(parent.content())
                    size(controller, anchor: anchor)
                }
                return
            }
            guard parent.isPresented, !scheduled else { return }
            scheduled = true
            DispatchQueue.main.async { [weak self, weak anchor] in
                guard let self else { return }
                scheduled = false
                guard parent.isPresented, let anchor, anchor.window != nil else { return }
                var responder: UIResponder? = anchor
                while let current = responder {
                    if let presenter = current as? UIViewController {
                        let hosting = ModelPopoverController(content: parent.content())
                        hosting.modalPresentationStyle = .popover
                        hosting.view.backgroundColor = .clear
                        size(hosting, anchor: anchor)
                        guard let popover = hosting.popoverPresentationController else { return }
                        popover.sourceView = anchor
                        popover.sourceRect = anchor.bounds
                        popover.permittedArrowDirections = [.up, .down, .left, .right]
                        popover.delegate = self
                        controller = hosting
                        presenter.present(hosting, animated: true)
                        return
                    }
                    responder = current.next
                }
            }
        }

        private func size(_ controller: ModelPopoverController<Content>, anchor: UIView) {
            guard let window = anchor.window else { return }
            let safe = window.safeAreaInsets
            controller.preferredContentSize = CGSize(
                width: min(320, window.bounds.width - safe.left - safe.right - 32),
                height: min(parent.height, window.bounds.height - safe.top - safe.bottom - 32))
        }

        func adaptivePresentationStyle(for controller: UIPresentationController) -> UIModalPresentationStyle { .none }
        func popoverPresentationControllerDidDismissPopover(_ popoverPresentationController: UIPopoverPresentationController) {
            controller = nil
            parent.isPresented = false
        }
    }
}

final class ModelPopoverController<Content: View>: UIViewController {
    private let hosting: UIHostingController<PopoverContent<Content>>

    init(content: Content) {
        hosting = UIHostingController(rootView: PopoverContent(content: content))
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        addChild(hosting)
        hosting.safeAreaRegions = []
        hosting.view.backgroundColor = .clear
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: safe.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: safe.trailingAnchor)
        ])
        hosting.didMove(toParent: self)
    }

    func setContent(_ content: Content) {
        hosting.rootView = PopoverContent(content: content)
    }
}

struct PopoverContent<Content: View>: View {
    let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .ignoresSafeArea(.keyboard)
    }
}
#endif
