#if os(iOS)
import UIKit
#endif

/// App-triggered feedback always observes the user's Haptics preference.
/// UIKit controls and Haptic Touch may also provide system feedback; UIKit has
/// no public per-control switch to suppress UIRefreshControl's own feedback.
enum AppHaptics {
    #if os(iOS)
    @MainActor static func refreshTriggered(enabled: Bool, feedback: UIImpactFeedbackGenerator) {
        guard enabled else { return }
        feedback.impactOccurred()
    }
    #endif
}
