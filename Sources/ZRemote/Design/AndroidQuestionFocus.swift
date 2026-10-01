#if SKIP
import SwiftUI
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalFocusManager

/// The pinned FocusState bridge requests focus but does not clear it when false.
/// An explicit dismissal token avoids clearing another field on ordinary blur.
struct AndroidQuestionFocusModifier: ContentModifier {
    let dismissal: Int

    func modify(view: any View) -> any View {
        ComposeView { context in
            let focusManager = LocalFocusManager.current
            let observedDismissal = remember { mutableStateOf(dismissal) }
            LaunchedEffect(dismissal) {
                // Initial composition must not dismiss a newly requested editor.
                if observedDismissal.value != dismissal {
                    observedDismissal.value = dismissal
                    focusManager.clearFocus()
                }
            }
            view.Compose(context: context)
        }
    }
}
#endif
