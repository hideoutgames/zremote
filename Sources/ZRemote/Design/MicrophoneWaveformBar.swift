#if os(iOS)
import AVFoundation
import SwiftUI

struct MicrophoneSample {
    let date: Date
    let amplitude: Float
}

struct MicrophoneWaveformBar: View {
    let onStarted: @MainActor () -> Void
    let close: @MainActor () -> Void
    let onError: @MainActor (String) -> Void
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase
    @State var samples: [MicrophoneSample] = (0..<100).map {
        MicrophoneSample(date: Date(timeIntervalSinceNow: -Double(100 - $0) * 0.08), amplitude: 0)
    }
    @State var recorder: AVAudioRecorder?

    var body: some View {
        HStack(spacing: 14) {
            Button(action: close) {
                Image(systemName: "xmark").font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Palette.text).frame(width: 44, height: 44)
                    .background(Palette.line, in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Cancel microphone")
            TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion)) { timeline in
                Canvas { context, size in
                    let speed: CGFloat = 100
                    // Each sample has an absolute position on the time axis.
                    // A meter update never resets the scrolling phase.
                    for (index, sample) in samples.enumerated() {
                        let x = reduceMotion ? size.width - CGFloat(samples.count - index) * 8
                            : size.width - CGFloat(timeline.date.timeIntervalSince(sample.date)) * speed
                        if x >= -3 && x <= size.width {
                            let height = max(3, CGFloat(sample.amplitude) * 30)
                            let rect = CGRect(x: x, y: (size.height - height) / 2, width: 3, height: height)
                            context.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(Palette.secondary))
                        }
                    }
                }.clipped()
            }.frame(height: 44).accessibilityLabel("Microphone input waveform")
            Button(action: close) {
                Image(systemName: "checkmark").font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Palette.background).frame(width: 44, height: 44)
                    .background(Palette.text, in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Finish microphone")
        }
        .task { await capture() }
        .onChange(of: scenePhase) { _, phase in if phase == .background { close() } }
    }

    @MainActor private func capture() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            if !Task.isCancelled { onError("Allow microphone access in Settings to show the input waveform.") }
            return
        }
        guard !Task.isCancelled else { return }
        let audio = AVAudioSession.sharedInstance()
        let url = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("zremote-microphone-" + UUID().uuidString + ".caf")
        defer {
            recorder?.stop()
            recorder = nil
            try? FileManager.default.removeItem(at: url)
            try? audio.setActive(false, options: .notifyOthersOnDeactivation)
        }
        do {
            try audio.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers])
            try audio.setAllowHapticsAndSystemSoundsDuringRecording(true)
            try audio.setActive(true)
            let input = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16
            ])
            input.isMeteringEnabled = true
            guard input.record() else {
                onError("The microphone couldn't start on this device.")
                return
            }
            recorder = input
            onStarted()
            while !Task.isCancelled {
                input.updateMeters()
                let power = input.averagePower(forChannel: 0)
                let level = max(0, min(1, (power + 60) / 60))
                let amplitude = (samples.last?.amplitude ?? level) * 0.35 + level * 0.65
                samples.append(MicrophoneSample(date: Date(), amplitude: amplitude))
                if samples.count > 100 { samples.removeFirst(samples.count - 100) }
                try await Task.sleep(for: .milliseconds(80))
            }
        } catch is CancellationError {
        } catch {
            onError("The microphone is unavailable. Please try again.")
        }
    }
}
#endif
