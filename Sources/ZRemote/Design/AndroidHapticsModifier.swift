#if SKIP
import SwiftUI
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback

/// Applies to app Compose feedback, including Skip's native long-press menus.
/// System keyboard and platform text-selection feedback stay under OS control.
struct AndroidHapticsModifier: ContentModifier {
    let enabled: Bool

    func modify(view: any View) -> any View {
        ComposeView { context in
            let nativeHaptics = LocalHapticFeedback.current
            let silentHaptics = remember { SilentHapticFeedback() }
            let effectiveHaptics: HapticFeedback = enabled ? nativeHaptics : silentHaptics
            // SKIP INSERT: val providedHaptics = LocalHapticFeedback provides effectiveHaptics
            CompositionLocalProvider(providedHaptics) {
                view.Compose(context: context)
            }
        }
    }
}

private final class SilentHapticFeedback: HapticFeedback {
    override func performHapticFeedback(_ hapticFeedbackType: HapticFeedbackType) {}
}
#endif
