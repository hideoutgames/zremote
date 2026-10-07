#if os(iOS)
import Foundation
import AVFoundation
@preconcurrency import Speech
import ZRemoteCore

@MainActor final class NativeDictation {
    private var recognizer: SFSpeechRecognizer?
    private var recognition: SFSpeechRecognitionTask?
    private var pending: CheckedContinuation<String, Error>?
    private var timeout: Task<Void, Never>?
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var result: Result<String, Error>?
    private var revision = UUID()
    private var inputTapInstalled = false
    var hasResult: Bool { result != nil }

    func prepare(locale identifier: String) async throws {
        var authorization = SFSpeechRecognizer.authorizationStatus()
        if authorization == .notDetermined {
            authorization = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { @Sendable status in
                    continuation.resume(returning: status)
                }
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

    func start(onPartial: @escaping @MainActor (String) -> Void,
               onLevel: @escaping @MainActor (Float) -> Void) throws {
        guard let recognizer else { throw ClientFailure("Dictation isn't ready. Please try again.") }
        let revision = UUID()
        self.revision = revision
        result = nil
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        self.request = request
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw ClientFailure("The microphone couldn't start on this device.")
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in
            request.append(buffer)
            var sum: Float = 0
            if let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 {
                for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
                sum = sqrt(sum / Float(buffer.frameLength))
            }
            let level = max(0, min(1, (20 * log10(max(sum, 0.000_001)) + 60) / 60))
            Task { @MainActor in onLevel(level) }
        }
        inputTapInstalled = true
        recognition = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let final = result?.isFinal == true
            let failed = error != nil
            Task { @MainActor in
                guard let self, self.revision == revision else { return }
                if let text { onPartial(text) }
                if final, let text { self.finish(.success(text)) }
                else if failed { self.finish(.failure(ClientFailure("Dictation couldn't transcribe this recording. Try again, or choose another language in Settings."))) }
            }
        }
        engine.prepare()
        try engine.start()
    }

    func transcribe() async throws -> String {
        try Task.checkCancellation()
        stopInput()
        request?.endAudio()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            if let result { return try result.get() }
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(45)) } catch { return }
                    self?.finish(.failure(ClientFailure("Dictation took too long. Please try again.")))
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel() }
        }
    }

    func cancel() {
        revision = UUID()
        stopInput()
        request = nil
        recognition?.cancel(); recognition = nil
        finish(.failure(CancellationError()))
    }

    private func stopInput() {
        if let engine {
            engine.stop()
            if inputTapInstalled { engine.inputNode.removeTap(onBus: 0) }
            inputTapInstalled = false
            self.engine = nil
        }
    }

    private func finish(_ result: Result<String, Error>) {
        guard self.result == nil else { return }
        self.result = result
        let continuation = pending
        pending = nil
        timeout?.cancel(); timeout = nil
        continuation?.resume(with: result)
    }
}
#endif
