import Foundation
import SwiftUI
import ZRemoteCore

struct BackgroundSettings: View {
    @Bindable var model: AppModel
    @State var source: AttachmentSource?
    @State var request = ""
    @State var importContext = ""
    @State var importing = false
    @State var preparing = false
    @State var failure: String?

    var body: some View {
        Section {
            Toggle("New Composer background", isOn: Binding(
                get: { model.preferences.backgroundEnabled }, set: model.setBackground
            )).tint(Palette.addition)
            if model.preferences.backgroundEnabled {
                Menu {
                    Button { select(.photos) } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                    Button { select(.files) } label: { Label("Choose File", systemImage: "folder") }
                } label: {
                    HStack {
                        Label(model.preferences.backgroundImageData == nil ? "Upload Background Image" : "Change Background Image", systemImage: "photo")
                        Spacer()
                        if importing { ProgressView() }
                    }
                }.disabled(importing)
                if model.preferences.backgroundImageData != nil {
                    Picker("Mode", selection: Binding(
                        get: { model.preferences.backgroundEffect }, set: model.setBackgroundEffect
                    )) {
                        ForEach(BackgroundMode.allCases) { mode in Text(mode.label).tag(mode.rawValue) }
                    }
                    ComposerBackground(data: model.preferences.backgroundImageData, effect: model.preferences.backgroundEffect)
                        .frame(height: 130).clipShape(RoundedRectangle(cornerRadius: 14))
                        .listRowBackground(Palette.background)
                    Button("Remove Background Image", role: .destructive) { model.setBackgroundImage(data: nil, name: nil) }
                }
            }
        }
        .listRowBackground(Palette.surface)
        #if os(iOS)
        .sheet(item: $source, onDismiss: { if !preparing { importing = false } }) { selection in
            let context = importContext
            let ticket = request
            IOSAttachmentPicker(source: selection) { result in
                source = nil
                accept(result, context: context, ticket: ticket)
            }
        }
        #elseif os(Android)
        .background {
            let context = importContext
            let ticket = request
            ComposeView {
                AttachmentLauncher(source: source?.rawValue ?? "", request: request) { path, name, mime, error in
                    source = nil
                    guard error.isEmpty else { failure = error; importing = false; return }
                    guard !path.isEmpty else { importing = false; return }
                    Task {
                        let result = await Task.detached(priority: .userInitiated) {
                            let url = URL(fileURLWithPath: path)
                            defer { try? FileManager.default.removeItem(at: url) }
                            return Result { try AttachmentFiles.read(url, name: name, mime: mime) }
                        }.value
                        switch result {
                        case .success(let image): accept(.success(image), context: context, ticket: ticket)
                        case .failure: accept(.failure(.unreadable), context: context, ticket: ticket)
                        }
                    }
                }
            }.frame(width: 0, height: 0)
        }
        #endif
        .alert("Background Image", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) { failure = nil }
        } message: { Text(failure ?? "") }
    }

    private func select(_ selection: AttachmentSource) {
        guard !importing else { return }
        importing = true
        importContext = model.attachmentContext
        request = UUID().uuidString
        source = selection
    }

    private func accept(_ result: Result<LocalAttachment, AttachmentImportFailure>?, context: String, ticket: String) {
        guard ticket == request else { return }
        guard let result else { importing = false; return }
        preparing = true
        Task {
            defer { importing = false; preparing = false }
            do {
                let image = try result.get()
                guard image.mimeType.hasPrefix("image/"), let data = await BackgroundImages.prepare(image.data) else {
                    failure = "Choose a supported image smaller than 24 MB."; return
                }
                guard ticket == request, model.attachmentContext == context else { return }
                model.setBackgroundImage(data: data, name: image.name)
            } catch {
                failure = (error as? LocalizedError)?.errorDescription ?? "This image couldn't be opened."
            }
        }
    }
}
