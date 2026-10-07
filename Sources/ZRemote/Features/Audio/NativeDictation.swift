#if os(iOS)
import Foundation
import Speech
import ZRemoteCore

@MainActor final class NativeDictation {
    private var recognizer: SFSpeechRecognizer?
    private var recognition: SFSpeechRecognitionTask?
    private var pending: CheckedContinuation<String, Error>?
    private var timeout: Task<Void, Never>?

    func prepare(locale identifier: String) async throws {
        var authorization = SFSpeechRecognizer.authorizationStatus()
        if authorization == .notDetermined {
            authorization = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
        }
        try Task.checkCancellation()
        guard authorization == .authorized else {
            throw ClientFailure("Allow Speech Recognition in Settings to use Dictation.")
        }
        let locale = identifier.isEmpty ? Locale.current : Locale(identifier: identifier)
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.supportsOnDeviceRecognition else {
            throw ClientFailure("On-device Dictation isn't available for this language. Choose another language or install an Audio Model in Settings.")
        }
        self.recognizer = recognizer
    }

    func transcribe(_ url: URL) async throws -> String {
        try Task.checkCancellation()
        guard let recognizer else { throw ClientFailure("Dictation isn't ready. Please try again.") }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                let request = SFSpeechURLRecognitionRequest(url: url)
                request.requiresOnDeviceRecognition = true
                request.shouldReportPartialResults = false
                request.addsPunctuation = true
                recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
                    let text = result?.isFinal == true ? result?.bestTranscription.formattedString : nil
                    let failed = error != nil
                    Task { @MainActor in
                        if let text { self?.finish(.success(text)) }
                        else if failed { self?.finish(.failure(ClientFailure("Dictation couldn't transcribe this recording. Try again, or choose another language in Settings."))) }
                    }
                }
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(45)) } catch { return }
                    self?.finish(.failure(ClientFailure("Dictation took too long. Please try again.")))
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.finish(.failure(CancellationError())) }
        }
    }

    private func finish(_ result: Result<String, Error>) {
        guard let continuation = pending else { return }
        pending = nil
        timeout?.cancel(); timeout = nil
        recognition?.cancel(); recognition = nil
        continuation.resume(with: result)
    }
}
#endif
