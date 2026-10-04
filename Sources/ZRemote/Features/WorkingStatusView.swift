import SwiftUI
import ZRemoteCore

struct WorkingStatusView: View {
    let sessionID: String
    let startedAt: Date
    @Environment(\.scenePhase) var scenePhase
    @State var now = Date()

    var body: some View {
        let seconds = WorkingStatus.seconds(since: startedAt, now: now)
        HStack(spacing: 8) {
            ActivityGlyph()
            ShimmerText(text: WorkingStatus.word(sessionID: sessionID, elapsed: seconds) + "…")
                .font(.subheadline).lineLimit(1)
            Text(WorkingStatus.elapsed(seconds)).font(.caption).monospacedDigit()
                .foregroundStyle(Palette.secondary.opacity(0.85))
                .accessibilityIdentifier("working-elapsed")
        }
        .padding(.leading, 4)
        .accessibilityIdentifier("working-status")
        .task(id: sessionID) {
            while !Task.isCancelled {
                now = Date()
                do { try await Task.sleep(nanoseconds: 1_000_000_000) }
                catch { return }
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { now = Date() } }
    }
}
