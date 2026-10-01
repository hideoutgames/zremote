import SwiftUI

/// Mount only while a custom tablet modal is visible. Android removes the
/// callback when this view leaves composition; iOS uses its native dismissal.
struct ModalBackHandler: View {
    let onDismiss: () -> Void

    init(onDismiss: @escaping () -> Void) {
        self.onDismiss = onDismiss
    }

    var body: some View {
        #if os(Android)
        ComposeView { ModalBackComposer(onDismiss: onDismiss) }
            .frame(width: 0, height: 0)
        #else
        EmptyView()
        #endif
    }
}

#if SKIP
import androidx.activity.compose.BackHandler

// ContentComposer declarations in a native module's SKIP block are bridged
// automatically, including the Swift closure passed to the Android callback.
struct ModalBackComposer: ContentComposer {
    let onDismiss: () -> Void

    @Composable func Compose(context: ComposeContext) {
        BackHandler(enabled: true, onBack: onDismiss)
    }
}
#endif
