#if os(iOS)
import SwiftUI
import UIKit
import ZRemoteCore

struct NativeSessionRenameAlert: UIViewRepresentable {
    @Binding var session: Session?
    let save: @MainActor (Session, String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard let session, context.coordinator.alert == nil else { return }
        let coordinator = context.coordinator
        let binding = $session
        let save = save
        let alert = UIAlertController(title: "Rename session", message: nil, preferredStyle: .alert)
        alert.addTextField { $0.text = session.title }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in binding.wrappedValue = nil })
        alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak alert] _ in
            let title = alert?.textFields?.first?.text ?? ""
            binding.wrappedValue = nil
            save(session, title)
        })
        coordinator.alert = alert
        Task { @MainActor [weak view] in
            guard let view, let root = view.window?.rootViewController else {
                coordinator.alert = nil
                return
            }
            var presenter = root
            while let presented = presenter.presentedViewController { presenter = presented }
            presenter.present(alert, animated: true) {
                guard let field = alert.textFields?.first else { return }
                field.becomeFirstResponder()
                field.selectedTextRange = field.textRange(from: field.beginningOfDocument, to: field.endOfDocument)
            }
        }
    }

    @MainActor final class Coordinator {
        weak var alert: UIAlertController?
    }
}
#endif
