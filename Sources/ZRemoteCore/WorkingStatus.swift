import Foundation

/// The official iOS Motion.swift vocabulary (853872d), still used by the
/// desktop transcript at 9e1a111. Stable per-chat FNV-1a seed, seven-second steps.
public enum WorkingStatus {
    public static let words = [
        "Zeroning", "Thinking", "Pondering", "Scheming", "Brewing", "Weaving",
        "Tinkering", "Musing", "Composing", "Sifting", "Untangling", "Distilling",
        "Sketching", "Plotting", "Riffing", "Combobulating", "Percolating",
        "Marinating", "Noodling", "Puzzling", "Conjuring"
    ]

    public static func seconds(since start: Date, now: Date) -> Int {
        let elapsed = now.timeIntervalSince(start)
        guard elapsed.isFinite, elapsed > 0 else { return 0 }
        return Int(min(elapsed.rounded(.down), Double(Int.max / 2)))
    }

    public static func word(sessionID: String, elapsed: Int) -> String {
        var seed: UInt64 = 0xcbf29ce484222325
        for byte in sessionID.utf8 { seed = (seed ^ UInt64(byte)) &* 0x100000001b3 }
        return words[Int((seed &+ UInt64(max(0, elapsed) / 7)) % UInt64(words.count))]
    }

    public static func elapsed(_ seconds: Int) -> String {
        let seconds = max(0, seconds)
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m \(seconds % 60)s" }
        return "\(seconds / 3600)h \((seconds % 3600) / 60)m"
    }

    /// Keep the fallback in session state, not in a recycled SwiftUI row.
    /// Host timing can arrive later and always replaces that fallback.
    public static func start(for next: SessionState, previous: SessionState?, now: Date) -> Date? {
        guard next.working else { return nil }
        if let start = next.workingStartedAt { return start }
        if previous?.working == true, previous?.turnID == next.turnID, let start = previous?.workingStartedAt { return start }
        return now
    }
}
