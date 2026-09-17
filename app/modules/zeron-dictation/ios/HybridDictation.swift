// HybridDictation — Nitro HybridObject for on-device speech dictation.
//
// IMPLEMENTED-BUT-UNVERIFIED: written on Windows; first compiled on a Mac
// (docs/NATIVE_MODULES.md). Two paths:
//   iOS 26+ : SpeechAnalyzer + SpeechTranscriber (volatile → partials,
//             finalized → finals; AssetInventory for model downloads)
//   iOS 17–25: SFSpeechRecognizer with requiresOnDeviceRecognition = true
//             (never falls back to server recognition).
// No audio is written to disk; the engine is released on stop/cancel.

import AVFAudio
import NitroModules
import Speech

class HybridDictation: HybridDictationSpec {
  private let engine = AVAudioEngine()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var running = false
  private var interruptionObserver: NSObjectProtocol?
  private var routeObserver: NSObjectProtocol?

  // MARK: capability

  func isSupported() throws -> Promise<DictationSupport> {
    Promise.async {
      await withCheckedContinuation { cont in
        SFSpeechRecognizer.requestAuthorization { status in
          AVAudioApplication.requestRecordPermission { mic in
            guard mic else {
              cont.resume(returning: DictationSupport(
                supported: false, onDevice: false,
                reason: .some("microphone permission denied")))
              return
            }
            guard status == .authorized else {
              cont.resume(returning: DictationSupport(
                supported: false, onDevice: false,
                reason: .some("speech recognition not authorized")))
              return
            }
            let rec = SFSpeechRecognizer()
            let onDevice = rec?.supportsOnDeviceRecognition ?? false
            cont.resume(returning: DictationSupport(
              supported: rec?.isAvailable == true && onDevice,
              onDevice: onDevice,
              reason: onDevice
                ? .none
                : .some("on-device recognition unavailable on this hardware/locale")))
          }
        }
      }
    }
  }

  // MARK: models

  func modelState(locale: String) throws -> Promise<DictationModelState> {
    Promise.async {
      if #available(iOS 26.0, *) {
        // SpeechTranscriber.supportedLocales / installedLocales — checked on
        // Mac build; fall back to the SFSpeechRecognizer signal meanwhile.
      }
      guard let rec = SFSpeechRecognizer(
        locale: Locale(identifier: locale)
      ), rec.supportsOnDeviceRecognition else {
        return .unsupported
      }
      return .installed
    }
  }

  func downloadModel(
    locale: String,
    onProgress: @escaping (Double) -> Void
  ) throws -> Promise<Void> {
    Promise.async {
      if #available(iOS 26.0, *) {
        // TODO(macOS build): AssetInventory.assetInstallationRequest for the
        // SpeechTranscriber locale, reporting fractionCompleted.
      }
      throw NSError(
        domain: "zeron-dictation", code: 2,
        userInfo: [NSLocalizedDescriptionKey:
          "model download requires iOS 26 SpeechAnalyzer path"])
    }
  }

  // MARK: session lifecycle

  func start(
    locale: String?,
    onPartial: @escaping (String) -> Void,
    onFinal: @escaping (String) -> Void,
    onError: @escaping (String) -> Void
  ) throws -> Promise<Void> {
    Promise.async {
      if #available(iOS 26.0, *) {
        // TODO(macOS build): SpeechAnalyzer + SpeechTranscriber pipeline —
        // AVAudioEngine input → AsyncStream<AnalyzerInput>; volatile results
        // → onPartial, finalized → onFinal. The SFSpeechRecognizer path below
        // still works on 26 and is used until this branch is compiled.
      }
      let loc = locale.map { Locale(identifier: $0) } ?? .autoupdatingCurrent
      guard let rec = SFSpeechRecognizer(locale: loc),
            rec.isAvailable, rec.supportsOnDeviceRecognition
      else {
        onError("on-device recognition unsupported for locale \(loc.identifier)")
        return
      }
      self.recognizer = rec

      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement,
                              options: [.duckOthers])
      try session.setActive(true, options: .notifyOthersOnDeactivation)

      let req = SFSpeechAudioBufferRecognitionRequest()
      req.requiresOnDeviceRecognition = true   // never server recognition
      req.shouldReportPartialResults = true
      self.request = req

      self.task = rec.recognitionTask(with: req) { result, error in
        if let result {
          let text = result.bestTranscription.formattedString
          if result.isFinal { onFinal(text) } else { onPartial(text) }
        }
        if let error { onError(error.localizedDescription) }
      }

      let input = self.engine.inputNode
      input.installTap(onBus: 0, bufferSize: 1024,
                       format: input.outputFormat(forBus: 0)) { buf, _ in
        req.append(buf)
      }
      try self.engine.start()
      self.running = true

      let center = NotificationCenter.default
      self.interruptionObserver = center.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil
      ) { [weak self] _ in self?.teardown() }
      self.routeObserver = center.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil
      ) { [weak self] _ in self?.teardown() }
    }
  }

  func stop() throws -> Promise<Void> {
    Promise.async {
      self.request?.endAudio()
      self.teardown()
    }
  }

  func cancel() throws -> Promise<Void> {
    Promise.async {
      self.task?.cancel()
      self.teardown()
    }
  }

  private func teardown() {
    guard running else { return }
    running = false
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request = nil
    task = nil
    if let o = interruptionObserver {
      NotificationCenter.default.removeObserver(o)
    }
    if let o = routeObserver {
      NotificationCenter.default.removeObserver(o)
    }
    try? AVAudioSession.sharedInstance()
      .setActive(false, options: .notifyOthersOnDeactivation)
  }
}
