#if os(iOS)
import Foundation
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import ZRemoteCore

struct IOSAttachmentPicker: UIViewControllerRepresentable {
    let source: AttachmentSource
    let completed: @MainActor (Result<LocalAttachment, AttachmentImportFailure>?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(completed: completed) }

    func makeUIViewController(context: Context) -> UIViewController {
        switch source {
        case .files:
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
            picker.allowsMultipleSelection = false
            picker.delegate = context.coordinator
            return picker
        case .photos:
            var configuration = PHPickerConfiguration()
            configuration.filter = .images
            configuration.selectionLimit = 1
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = context.coordinator
            return picker
        case .camera:
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.mediaTypes = [UTType.image.identifier]
            picker.delegate = context.coordinator
            picker.modalPresentationStyle = .fullScreen
            return picker
        }
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    @MainActor final class Coordinator: NSObject, UIDocumentPickerDelegate, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completed: @MainActor (Result<LocalAttachment, AttachmentImportFailure>?) -> Void
        init(completed: @escaping @MainActor (Result<LocalAttachment, AttachmentImportFailure>?) -> Void) { self.completed = completed }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { completed(nil) }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { completed(nil); return }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            Task {
                let result = await Task.detached(priority: .userInitiated) {
                    Result { try AttachmentFiles.read(url, name: url.lastPathComponent, mime: mime) }
                }.value
                finish(result)
            }
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else { completed(nil); return }
            let identifier = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
            let type = UTType(identifier)
            let mime = type?.preferredMIMEType ?? "image/jpeg"
            let name = "Photo." + (type?.preferredFilenameExtension ?? "jpg")
            let completion = completed
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, _ in
                // The provider's temporary file expires after this callback.
                let result: Result<LocalAttachment, AttachmentImportFailure>
                do {
                    guard let url else { throw AttachmentImportFailure.unreadable }
                    result = .success(try AttachmentFiles.read(url, name: name, mime: mime))
                } catch { result = .failure(error as? AttachmentImportFailure ?? .unreadable) }
                Task { @MainActor in completion(result) }
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { completed(nil) }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage else { completed(.failure(.unreadable)); return }
            Task {
                let bytes = await Task.detached(priority: .userInitiated) { image.jpegData(compressionQuality: 0.88) }.value
                guard let bytes else { completed(.failure(.unreadable)); return }
                guard bytes.count <= LocalAttachment.maximumBytes else { completed(.failure(.tooLarge)); return }
                completed(.success(LocalAttachment(name: "Camera photo.jpg", mimeType: "image/jpeg", data: bytes)))
            }
        }

        private func finish(_ result: Result<LocalAttachment, any Error>) {
            switch result {
            case .success(let value): completed(.success(value))
            case .failure(let error): completed(.failure(error as? AttachmentImportFailure ?? .unreadable))
            }
        }
    }
}
#endif
