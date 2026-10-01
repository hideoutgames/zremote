import Foundation
import SwiftUI
import ZRemoteCore
#if os(iOS)
import AVFoundation
import UIKit
#endif

enum AttachmentSource: String, Identifiable {
    case files, photos, camera
    var id: String { rawValue }
}

enum AttachmentImportFailure: String, Error, LocalizedError, Sendable {
    case tooLarge = "Choose a file smaller than 24 MB."
    case unreadable = "This file couldn't be opened. Try choosing it again."
    case cameraUnavailable = "A camera isn't available on this device."
    case cameraPermission = "Allow camera access in your device's Settings to take a photo."
    var errorDescription: String? { rawValue }
}

/// System pickers keep their local URLs inside this layer. The client receives
/// only a filename, MIME type and bounded bytes, never a device-local URL.
struct AttachmentPicker: View {
    @Bindable var model: AppModel
    @State var source: AttachmentSource?
    @State var cameraPresented = false
    @State var request = ""
    @State var importContext = ""
    @State var importing = false
    @State var failure: String?

    var body: some View {
        Menu {
            Button { select(.files) } label: { Label("Files", systemImage: "doc") }
            Button { select(.photos) } label: { Label("Photos", systemImage: "photo") }
            Button { select(.camera) } label: { Label("Camera", systemImage: "camera") }
        } label: {
            Group {
                if importing { ProgressView().tint(Palette.secondary) }
                else { Image(systemName: "plus").font(.system(size: 18, weight: .medium)) }
            }
            .frame(width: 44, height: 44)
            .foregroundStyle(Palette.secondary)
        }
        .disabled(importing || model.busy)
        .accessibilityLabel(importing ? "Preparing attachment" : "Add attachment")
        #if os(iOS)
        .sheet(item: $source, onDismiss: { importing = false }) { selection in
            let context = importContext
            IOSAttachmentPicker(source: selection) { finish($0, context: context) }
                .ignoresSafeArea(edges: .bottom)
        }
        .fullScreenCover(isPresented: $cameraPresented, onDismiss: { importing = false }) {
            let context = importContext
            IOSAttachmentPicker(source: .camera) { finish($0, context: context) }.ignoresSafeArea()
        }
        #elseif os(Android)
        .background {
            ComposeView {
                AttachmentLauncher(source: source?.rawValue ?? "", request: request) { path, name, mime, error in
                    source = nil
                    if !error.isEmpty { failure = error; importing = false; return }
                    guard !path.isEmpty else { importing = false; return }
                    let context = importContext
                    Task {
                        let result = await Task.detached(priority: .userInitiated) {
                            let url = URL(fileURLWithPath: path)
                            defer { try? FileManager.default.removeItem(at: url) }
                            return Result { try AttachmentFiles.read(url, name: name, mime: mime) }
                        }.value
                        switch result {
                        case .success(let value): finish(.success(value), context: context)
                        case .failure(let error): finish(.failure(error as? AttachmentImportFailure ?? .unreadable), context: context)
                        }
                    }
                }
            }.frame(width: 0, height: 0)
        }
        #endif
        .alert("Attachment", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
    }

    private func select(_ value: AttachmentSource) {
        importContext = model.attachmentContext
        importing = true
        #if os(iOS)
        if value == .camera {
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                importing = false; failure = AttachmentImportFailure.cameraUnavailable.rawValue; return
            }
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                if granted { cameraPresented = true }
                else { importing = false; failure = AttachmentImportFailure.cameraPermission.rawValue }
            }
            return
        }
        #endif
        source = value
        request = UUID().uuidString
        #if os(Android)
        importing = true
        #endif
    }

    private func finish(_ result: Result<LocalAttachment, AttachmentImportFailure>?, context: String) {
        source = nil; cameraPresented = false; importing = false
        guard let result else { return }
        do { try model.addAttachment(result.get(), context: context) }
        catch { failure = (error as? LocalizedError)?.errorDescription ?? "This attachment couldn't be added." }
    }
}

enum AttachmentFiles {
    static func read(_ url: URL, name: String, mime: String) throws -> LocalAttachment {
        #if os(iOS)
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        #endif
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var bytes = Data()
        while let chunk = try handle.read(upToCount: 128 * 1024), !chunk.isEmpty {
            guard bytes.count + chunk.count <= LocalAttachment.maximumBytes else { throw AttachmentImportFailure.tooLarge }
            bytes.append(chunk)
        }
        return LocalAttachment(name: name, mimeType: mime, data: bytes)
    }

    static func cache(_ data: Data, name: String) throws -> URL {
        guard data.count <= LocalAttachment.maximumBytes else { throw AttachmentImportFailure.tooLarge }
        #if os(Android)
        let folder = URL(fileURLWithPath: androidAttachmentCacheDirectory())
        #else
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-attachments", isDirectory: true)
        #endif
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Previews shared with another app remain readable briefly, then expire.
        // This private cache is the only directory exposed by our FileProvider.
        let cutoff = Date().addingTimeInterval(-3600)
        for old in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            if let modified = try? old.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, modified < cutoff {
                try? FileManager.default.removeItem(at: old)
            }
        }
        let safeName = URL(fileURLWithPath: name).lastPathComponent
        let url = folder.appendingPathComponent(UUID().uuidString + "-" + (safeName.isEmpty ? "Attachment" : safeName))
        try data.write(to: url, options: .atomic)
        return url
    }
}
