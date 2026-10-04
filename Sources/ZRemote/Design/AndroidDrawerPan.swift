#if SKIP
import SwiftUI
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity

/// A child-first, direction-locked drawer drag. Existing scrolling and text
/// selection keep their consumed movement; ordinary row taps remain native.
struct DrawerPanModifier: ContentModifier {
    let enabled: Bool
    let onBegin: (Double, Double, Double) -> Bool
    let onChange: (Double) -> Void
    let onEnd: (Double, Double) -> Void
    let onCancel: () -> Void

    init(enabled: Bool, onBegin: @escaping (Double, Double, Double) -> Bool, onChange: @escaping (Double) -> Void, onEnd: @escaping (Double, Double) -> Void, onCancel: @escaping () -> Void) {
        self.enabled = enabled
        self.onBegin = onBegin
        self.onChange = onChange
        self.onEnd = onEnd
        self.onCancel = onCancel
    }

    func modify(view: any View) -> any View {
        ComposeView { context in
            let latestEnabled = rememberUpdatedState(enabled)
            let latestBegin = rememberUpdatedState(onBegin)
            let latestChange = rememberUpdatedState(onChange)
            let latestEnd = rememberUpdatedState(onEnd)
            let latestCancel = rememberUpdatedState(onCancel)
            let latestDensity = rememberUpdatedState(LocalDensity.current.density)
            var childContext = context
            // Only enable/disable changes restart the pointer coroutine. Drawer
            // animation updates and new callbacks cannot interrupt an active drag.
            childContext.modifier = context.modifier.pointerInput(enabled) {
                if enabled {
                    awaitEachGesture {
                        var accepted = false
                        defer {
                            // Includes multi-touch, child takeover, disabling and
                            // composition disposal. Cancellation never commits.
                            if accepted { latestCancel.value() }
                        }
                        // Buttons consume down to start their ripple. Wait for
                        // movement before giving child gestures first refusal.
                        let down = awaitFirstDown(requireUnconsumed: false, pass: PointerEventPass.Main)
                        guard !currentEvent.changes.any({ $0.id != down.id && $0.pressed }) else { return }
                        let density = Double(latestDensity.value)
                        let tracker = VelocityTracker()
                        tracker.addPosition(down.uptimeMillis, down.position)
                        while true {
                            let event = awaitPointerEvent(pass: PointerEventPass.Main)
                            guard latestEnabled.value,
                                  !event.changes.any({ $0.id != down.id && $0.pressed }),
                                  let change = event.changes.firstOrNull({ $0.id == down.id }),
                                  !change.isConsumed else { break }
                            tracker.addPosition(change.uptimeMillis, change.position)
                            let delta = change.position - down.position
                            let dx = Double(delta.x) / density
                            let dy = Double(delta.y) / density
                            if !change.pressed {
                                if accepted {
                                    accepted = false
                                    change.consume()
                                    latestEnd.value(dx, Double(tracker.calculateVelocity().x) / density)
                                }
                                break
                            }
                            if !accepted {
                                // A held touch belongs to selection/context menus,
                                // even if it later starts moving horizontally.
                                if change.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis { break }
                                if delta.getDistance() < viewConfiguration.touchSlop { continue }
                                guard latestBegin.value(Double(down.position.x) / density, dx, dy) else { break }
                                accepted = true
                            }
                            change.consume()
                            latestChange.value(dx)
                        }
                    }
                }
            }
            view.Compose(context: childContext)
        }
    }
}
#endif
