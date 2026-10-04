import Foundation
import ZRemoteCore
#if os(iOS)
import AudioToolbox
import UIKit
#endif

enum AppFeedbackSounds {
    static let names = ["send", "voiceStart", "voiceFinish", "refresh", "finished"]
    static let paths: [String] = names.map { name in
        guard let url = Bundle.module.url(forResource: "feedback-" + name, withExtension: "wav") else { return "" }
        #if os(Android)
        // Android bundle URLs may point into APK assets. SoundPool needs a real
        // file; materialize the small bundled cues once per process.
        let local = FileManager.default.temporaryDirectory.appendingPathComponent("zremote-feedback-" + name + ".wav")
        do { try Data(contentsOf: url).write(to: local, options: .atomic); return local.path }
        catch { return "" }
        #else
        return url.path
        #endif
    }
}

#if os(iOS)
/// Retained generators are prepared after each interaction. All custom feedback
/// observes account preferences; system sounds follow the device alert settings.
@MainActor enum AppHaptics {
    private static let selection = UISelectionFeedbackGenerator()
    private static let impact = UIImpactFeedbackGenerator(style: .soft)
    private static var soundIDs: [String: SystemSoundID] = [:]

    static func prepare() {
        selection.prepare(); impact.prepare()
        for name in AppFeedbackSounds.names where soundIDs[name] == nil {
            guard let url = Bundle.module.url(forResource: "feedback-" + name, withExtension: "wav") else { continue }
            var id: SystemSoundID = 0
            if AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError { soundIDs[name] = id }
        }
    }

    static func play(_ event: InteractionFeedback, haptics: Bool, sounds: Bool) {
        if haptics {
            if event == .selection { selection.selectionChanged(); selection.prepare() }
            else { impact.impactOccurred(intensity: event == .finished ? 0.45 : 0.65); impact.prepare() }
        }
        guard sounds, event != .selection else { return }
        if soundIDs[event.rawValue] == nil { prepare() }
        if let id = soundIDs[event.rawValue] { AudioServicesPlaySystemSound(id) }
    }
}
#endif
