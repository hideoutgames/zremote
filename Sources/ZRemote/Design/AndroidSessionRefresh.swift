#if SKIP
import SwiftUI
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp

/// Native nested scrolling consumes only the downward drag left over once the
/// child reaches its top. Material owns the threshold, release and settling;
/// the shared views supply the recessed wallpaper and activity indicator.
struct SessionRefreshComposer: ContentComposer {
    let content: any View
    let recess: any View
    let refreshing: Bool
    let hapticsEnabled: Bool
    let onRefresh: () -> Void

    @Composable func Compose(context: ComposeContext) {
        let state = rememberPullToRefreshState()
        let threshold = PullToRefreshDefaults.PositionalThreshold
        let haptic = LocalHapticFeedback.current
        let latestRefreshing = rememberUpdatedState(refreshing)
        let latestHapticsEnabled = rememberUpdatedState(hapticsEnabled)
        let latestRefresh = rememberUpdatedState(onRefresh)
        let displacement = max(Float(0), state.distanceFraction) * threshold.value

        // The refresh recess replaces Android's stretch overscroll, which would
        // otherwise consume the same edge drag before the native refresh parent.
        // SKIP INSERT: val providedOverscrollFactory = LocalOverscrollFactory provides null
        CompositionLocalProvider(providedOverscrollFactory) {
            Box(modifier: context.modifier.fillMaxSize().clipToBounds().pullToRefresh(
                isRefreshing: refreshing, state: state, threshold: threshold, onRefresh: {
                    if !latestRefreshing.value {
                        // Commit feedback happens once after a qualifying release,
                        // never on animation frames or programmatic refreshes.
                        if latestHapticsEnabled.value {
                            haptic.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                        }
                        latestRefresh.value()
                    }
                }
            )) {
                content.Compose(context: context.content(modifier: Modifier.fillMaxSize().offset(y: displacement.dp)))
                // Keep the zero-height recess mounted so its image/filter is
                // ready before the next pull instead of decoding mid-gesture.
                Box(modifier: Modifier.fillMaxWidth().height(displacement.dp).clipToBounds()) {
                    recess.Compose(context: context.content(modifier: Modifier.fillMaxSize()))
                }
            }
        }
    }
}
#endif
