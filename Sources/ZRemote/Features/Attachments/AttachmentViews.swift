import Foundation
import SwiftUI
import ZRemoteCore
#if os(iOS)
import UIKit
import ImageIO
import QuickLook
#endif

struct ComposerAttachments: View {
    let attachments: [LocalAttachment]
    let remove: (String) -> Void
    @ScaledMetric(relativeTo: .caption) var captionHeight: CGFloat = 34

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 10) {
                ForEach(attachments) { attachment in
                    AttachmentTile(id: attachment.id, name: attachment.name, mime: attachment.mimeType,
                                   compact: true, remove: { remove(attachment.id) }, load: { attachment.data })
                }
            }.padding(.vertical, 4)
        }
        .frame(height: captionHeight + (attachments.contains { $0.mimeType.hasPrefix("image/") } ? 138 : 72))
    }
}

struct MessageAttachments: View {
    let attachments: [RemoteAttachment]
    var timestamp: Date? = nil
    let load: (RemoteAttachment) async throws -> Data
    @ScaledMetric(relativeTo: .caption) var captionHeight: CGFloat = 34

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 10) {
                ForEach(attachments) { attachment in
                    AttachmentTile(id: attachment.id, name: attachment.name,
                                   mime: attachment.mimeType ?? "application/octet-stream",
                                   compact: false, remove: nil, load: { try await load(attachment) })
                        .nativeContextMenu {
                            if let timestamp {
                                Text(DateFormatter.localizedString(from: timestamp, dateStyle: .medium, timeStyle: .short))
                            }
                        }
                }
            }.padding(.vertical, 4)
        }
        .frame(height: captionHeight + (attachments.contains { $0.mimeType?.hasPrefix("image/") == true } ? 162 : 28))
    }
}

struct AttachmentTile: View {
    let id: String
    let name: String
    let mime: String
    let compact: Bool
    let remove: (() -> Void)?
    let load: () async throws -> Data
    @State var thumbnail: Image?
    @State var loading = false
    @State var preview: AttachmentPreviewFile?
    @State var previewURL: URL?
    @State var failure: String?
    @State var previewTask: Task<Void, Never>?

    private var isImage: Bool { mime.hasPrefix("image/") }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { previewTask = Task { await open() } } label: {
                VStack(alignment: .leading, spacing: 8) {
                    if isImage {
                        ZStack {
                            Palette.raised
                            if let thumbnail {
                                thumbnail.resizable().scaledToFill()
                            } else {
                                Image(systemName: "photo").foregroundStyle(Palette.secondary)
                            }
                        }
                        .frame(width: compact ? 112 : 192, height: compact ? 68 : 136)
                        .clipped()
                    }
                    HStack(spacing: 8) {
                        if !isImage { Image(systemName: "doc.text").foregroundStyle(Palette.secondary) }
                        Text(name).font(.caption).lineLimit(2).multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if loading { ProgressView().tint(Palette.secondary) }
                    }
                    .padding(.horizontal, 10).padding(.bottom, 10).padding(.top, isImage ? 0 : 10)
                }
                .frame(width: compact ? 112 : 192)
                .foregroundStyle(Palette.text)
                .background(Palette.raised)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(loading)
            .accessibilityLabel("Preview \(name)")
            if let remove {
                Button(action: remove) {
                    Label("Remove", systemImage: "xmark")
                        .font(.caption).foregroundStyle(Palette.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(name)")
            }
        }
        .frame(width: compact ? 112 : 192)
        .task(id: id) {
            guard isImage else { return }
            do {
                let data = try await load()
                guard !Task.isCancelled, data.count <= LocalAttachment.maximumBytes else { return }
                let image = await AttachmentImage.thumbnail(data)
                guard !Task.isCancelled else { return }
                thumbnail = image
            } catch { /* Keep the file tile available for an explicit retry. */ }
        }
        #if os(iOS)
        .sheet(item: $preview, onDismiss: clearPreview) { file in
            AttachmentQuickLook(url: file.url).ignoresSafeArea(edges: .bottom)
        }
        #endif
        .alert("Attachment", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
        .onDisappear { previewTask?.cancel(); clearPreview() }
    }

    private func open() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await load()
            try Task.checkCancellation()
            let url = try await Task.detached(priority: .userInitiated) {
                try AttachmentFiles.cache(data, name: name)
            }.value
            guard !Task.isCancelled else { try? FileManager.default.removeItem(at: url); return }
            #if os(Android)
            // The receiving app needs the cache file after this method returns.
            // A later attachment operation removes old preview files.
            if !androidPreviewAttachment(path: url.path, mime: mime) {
                try? FileManager.default.removeItem(at: url)
                failure = "No app is available to preview this file."
            }
            #else
            previewURL = url
            preview = AttachmentPreviewFile(url: url)
            #endif
        } catch is CancellationError { return }
        catch { failure = "This attachment couldn't be opened. Try again when the host is online." }
    }

    private func clearPreview() {
        if let previewURL { try? FileManager.default.removeItem(at: previewURL) }
        previewURL = nil
        preview = nil
    }
}

struct AttachmentPreviewFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

enum AttachmentImage {
    @MainActor static func thumbnail(_ data: Data) async -> Image? {
        #if os(Android)
        guard let small = await androidAttachmentThumbnail(data), let image = UIImage(data: small) else { return nil }
        return Image(uiImage: image)
        #elseif os(iOS)
        let image: UIImage? = await Task.detached(priority: .utility) {
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 512,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                  ] as CFDictionary) else { return nil }
            return UIImage(cgImage: image)
        }.value
        return image.map { Image(uiImage: $0) }
        #else
        return nil
        #endif
    }
}

#if os(iOS)
struct AttachmentQuickLook: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
    }
}
#endif
