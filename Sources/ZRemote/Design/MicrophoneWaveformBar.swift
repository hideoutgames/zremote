#if os(iOS)
import AVFoundation
import SwiftUI

struct MicrophoneWaveformBar: View {
    let close: @MainActor () -> Void
    let onError: @MainActor (String) -> Void
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase
    @State var samples: [Float] = Array(repeating: 0, count: 80)
    @State var sampledAt = Date()
    @State var recorder: AVAudioRecorder?

    var body: some View {
        HStack(spacing: 14) {
            Button(action: close) {
                Image(systemName: "xmark").font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Palette.text).frame(width: 44, height: 44)
                    .background(Palette.line, in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("Cancel microphone")
            TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
                let values = samples
                let elapsed = min(0.08, max(0, timeline.date.timeIntervalSince(sampledAt)))
                Canvas { context, size in
                    let spacing: CGFloat = 8
                    let count = min(values.count, Int(size.width / spacing) + 2)
                    let offset = reduceMotion ? 0 : CGFloat(elapsed / 0.08) * spacing
                    for index in 0..<count {
                        let amplitude = CGFloat(values[values.count - count + index])
                        let height = max(3, amplitude * 30)
                        let x = size.width - CGFloat(count - index) * spacing - offset
                        let rect = CGRect(x: x, y: (size.height - height) / 2, width: 3, height: height)
                        context.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(Palette.secondary))
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
            try audio.setCategory(.record, mode: .measurement)
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
            while !Task.isCancelled {
                input.updateMeters()
                let power = input.averagePower(forChannel: 0)
                samples.removeFirst()
                samples.append(max(0, min(1, (power + 60) / 60)))
                sampledAt = Date()
                try await Task.sleep(for: .milliseconds(80))
            }
        } catch is CancellationError {
        } catch {
            onError("The microphone is unavailable. Please try again.")
        }
    }
}
#endif
