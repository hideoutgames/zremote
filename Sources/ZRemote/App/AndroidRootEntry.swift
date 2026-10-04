#if os(Android)
import SkipBridge

/// Kotlin's generated peer has no allocator. The activity constructs
/// `ZRemoteRootView()` and this entry boxes the Swift value for that peer.
@_cdecl("Java_zremote_module_ZRemoteRootView_Swift_1constructor")
public func ZRemoteRootView_Swift_constructor(_ Java_env: JNIEnvPointer, _ Java_target: JavaObjectPointer) -> SwiftObjectPointer {
    SkipBridge.assumeMainActorUnchecked {
        SwiftObjectPointer.pointer(to: SwiftValueTypeBox(ZRemoteRootView()), retain: true)
    }
}
#endif
