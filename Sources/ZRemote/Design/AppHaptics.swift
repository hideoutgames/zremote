#if os(iOS)
import UIKit
#endif

/// App-triggered feedback always observes the user's Haptics preference.
/// UIKit controls and Haptic Touch may also provide system feedback; UIKit has
/// no public per-control switch to suppress UIRefreshControl's own feedback.
enum AppHaptics {
    #if os(iOS)
    @MainActor static func refreshTriggered(enabled: Bool, in view: UIView) {
        guard enabled, view.window != nil else { return }
        let feedback: UIImpactFeedbackGenerator
        if #available(iOS 17.5, *) {
            feedback = UIImpactFeedbackGenerator(style: .light, view: view)
        } else {
            feedback = UIImpactFeedbackGenerator(style: .light)
        }
        feedback.impactOccurred()
    }
    #endif
}
