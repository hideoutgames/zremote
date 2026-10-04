#if os(iOS)
import Foundation
import FluidAudio
import ZRemoteCore

actor ParakeetTranscriber {
    static let shared = ParakeetTranscriber()
    private var busy = false

    private init() {
        // Downloads belong exclusively to the explicit, verified Settings installer.
        // This also blocks the library's automatic corrupt-cache recovery download.
        DownloadUtils.enforceOffline = true
    }

    func validate(directory: URL, model: AudioModelID) async throws {
        guard !busy else { throw ClientFailure("The audio model is in use. Try again shortly.") }
        busy = true
        defer { busy = false }
        _ = try await AsrModels.load(from: directory, version: model == .multilingual ? .v3 : .v2)
    }

    func transcribe(_ url: URL, model id: AudioModelID) async throws -> String {
        guard !busy else { throw ClientFailure("The audio model is in use. Try again shortly.") }
        busy = true
        defer { busy = false }
        guard let model = AudioModelManifest.catalog.first(where: { $0.id == id }),
              await AudioModelAssets.shared.isInstalled(model) else {
            throw ClientFailure("Install an audio model in Settings, or select Dictation.")
        }
        try Task.checkCancellation()
        let directory = await AudioModelAssets.shared.directory(model)
        let models = try await AsrModels.load(from: directory, version: id == .multilingual ? .v3 : .v2)
        try Task.checkCancellation()
        let manager = AsrManager()
        do {
            try await manager.loadModels(models)
            var state = try TdtDecoderState()
            let result = try await manager.transcribe(url, decoderState: &state)
            await manager.cleanup()
            try Task.checkCancellation()
            return result.text
        } catch {
            await manager.cleanup()
            throw error
        }
    }
}
#endif
