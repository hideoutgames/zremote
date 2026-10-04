# Native development

## Session tool activity and live status

The Swift/Skip transcript preserves host part order: prose, consecutive tool and
thought groups, and subagent cards. Groups use the official iOS connected rail,
summary, tool icons, file badges and nested disclosures. Only the streaming tail
opens automatically; explicit disclosure choices survive updates and completion.
Expanded details show the invocation and streamed output, file diff or diff stats;
failed calls retain their error output. Tool-only messages remain visible and can
anchor the completed-turn footer. Auto-follow respects the reader's scroll state.

Details initially show 24 lines in a bounded viewport, with Show all for the
available preview. The peer bounds each detail to 32,768 characters / 400 lines;
larger or sidecar-backed results are marked as previews. This adapter does not
fetch full tool sidecar blobs. Reasoning stays separate from answer/copy prose.

The live status cycles through Zeron's 21 phrases every seven seconds using its
session seed, beside elapsed time such as `3m 12s`. Host `working_since_ms` supplies
the start; if absent, AppModel retains a per-turn fallback across updates and
session switches. Foregrounding recomputes wall-clock elapsed time, and idle turns
remove the indicator. The existing shimmer respects Reduce Motion.

Presentation references: official iOS `ToolViews.swift` and mobile `layout/tools.rs`
at `9e1a11158b0626237c814f4bd36f5948483ed797`; the phrase vocabulary/seed is from
iOS `Theme/Motion.swift` at `853872d3660047b28e81f80df7744a7f6f3b4beb` and remains in
the current desktop transcript. The newer UIKit working row uses fixed labels;
the requested rotating vocabulary is retained here.

For device review, open Try mode's Live agent playground, expand the running tool,
watch output update, close/reopen groups, scroll away from the tail, and Stop.
Open A quieter workspace for a settled file-edit preview. Also check live host
errors, long output, session switching/backgrounding, Reduce Motion, and both
phone/tablet layouts. Windows parsing and domain tests do not establish native
layout or Skip bridge compatibility.

## Tablet Sessions animation

On iOS, a dedicated animatable reveal width owns the retained Sessions panel and
its divider. The conversation receives the remaining width on each animation
frame, while descendant animation transactions are cleared so model updates and
native controls do not start competing layout animations. Tablet hamburger
actions explicitly animate the visibility change, including when invoked through
the native Liquid Glass button. Search and filter state survives hiding the
panel; hidden controls cannot receive touches or accessibility focus. Reduce
Motion applies the final width immediately. Phone drawer motion is independent.

## Session controls

The tablet Sessions panel animates its width together with the conversation,
retaining the list's layout and state while hidden. Reduce Motion disables the
sidebar spring. Tablet thread controls float over scrolling content without a
title or full-width glass header; phone threads retain their title and header.
Completed-turn "Worked for" labels use regular text weight.

The blank Composer keeps its wallpaper during Sessions and secondary presentations.
On phones, the wallpaper moves horizontally with the Composer page during drawer
gestures and settling. Image sizing and vertical masking retain full-window
alignment; the Sessions refresh recess remains anchored to the window.
The Composer always queues busy submissions; queued messages can still be steered
from their queue drawer. Active sub-agents open a session-scoped status list.
Offline hosts show a noninteractive Reconnecting indicator.
Working and Reconnecting text use the official iOS client's 3.4-second triangular
highlight sweep, drawn on a bounded 30 Hz timeline. Reduce Motion retains the
static readable label.

The iOS Sessions refresh recess measures overscroll from the resting inset
throughout a held pull, including UIKit's refresh-inset expansion. Its baseline
follows actual safe-area changes, excluding the refresh control's added inset.
Continuing or reversing a slow drag keeps the recess aligned with the moving
rows. After release, the native refresh settles at its loading height before
collapsing.

On iOS, the microphone control requests system permission and meters local input
for the scrolling waveform. Cancel and Finish discard the recording; neither
transcribes, attaches, nor sends audio. Leaving the Composer or backgrounding the
app stops capture. Android microphone capture is not implemented.

Sign-in uses Apple's custom-scheme authentication callback on iOS and reports safe
failure stages without exposing codes, tokens, or provider error descriptions.
Sign in and Add account validate the `zeron://callback` endpoint and a unique
matching browser-session state, then exchange the unique nonempty query code.
URL fragments are ignored, matching the official native Zeron client; they cannot
supply or override query credentials. Browser launch and cancellation can be
verified without an account, but successful login still requires provider access.
PR cards retain their first observed assistant-message anchor. The peer supplies
PR summaries without creation timestamps/message IDs, so an exact historical
creation position cannot be reconstructed for previously unseen PRs; those remain
accessible through the header PR menu instead of appearing at the chat tail.

The app is a Skip Fuse package. Shared Swift is in `Sources/ZRemote`; pure
domain code is in `Sources/ZRemoteCore`; the native Zeron client adapter is in
`Sources/ZRemoteNative`. `Darwin/` and `Android/` contain the platform entry points.
The application identity remains `no.hideout.zremote`.

The full application gives `ZRemoteCore` a direct dependency on SkipFuse 1.0.3.
`AppModel` imports it alongside Observation so native Android property reads and
mutations reach Compose's state tracking through the bridged observation registrar.
The `ZREMOTE_CORE_ONLY=1` manifest omits this dependency and uses standard Observation,
keeping the targeted domain tests independent of platform packages. See Skip's
[state bridging contract](https://skip.dev/docs/modules/skip-fuse-ui/#state-bridging).

## Toolchain

Complete app builds need macOS 15+, Xcode 26, Skip 1.9.12, Swift 6.1+, Rust 1.98.1,
Python 3, Java 21, Gradle 9.2.1, the Android SDK, and the Swift Android SDK.
Install the Rust iOS/Android targets and `cargo-ndk`; set `ANDROID_NDK_HOME` to
the NDK used by the Swift Android SDK. Direct Swift dependencies are pinned in
`Package.swift`; `Project.xcworkspace/xcshareddata/swiftpm/Package.resolved` also
locks their transitive dependencies. Rust uses its committed lockfile. Preserve
generated Swift package resolution when updating dependencies; regenerate
acknowledgements with the resolved versions.

Skip's conventional Android build invokes a SwiftUI/Xcode prebuild. Installing
an Android SDK on Windows does not make the full app build supported there.
Windows can run scoped Swift syntax checks and supported domain/native tests.
`scripts/android-environment.ps1` selects the user-local Java/SDK/Gradle installation
without changing system environment variables.

## Shared machine limits

Run heavy local commands through `python scripts/run-local.py --phase PHASE -- COMMAND`.
Phases are `rust`, `swift`, `android`, and `ios`. The machine-wide configuration is
`%LOCALAPPDATA%/ZRemote/local-resources.json` on Windows and
`~/.cache/ZRemote/local-resources.json` elsewhere (`ZREMOTE_RESOURCE_CONFIG` overrides
the path). The shared profile admits one heavy job, in arrival order, with a
3 GB available-memory floor and a bounded 30-minute queue. It never stops another
agent's process. Cargo and Gradle share caches. Each command records scoped source,
environment, and toolchain fingerprints before and after execution; changed inputs
make the result stale and fail the check. Result records live in `ZRemote/results`
alongside the resource configuration. No cached test result is substituted for a
requested command. Gradle workers and Cargo jobs remain one.
While a child is running, the runner reports elapsed time and available memory
every minute without logging command arguments. This indicates liveness, not
compiler progress, and does not alter FIFO admission or provenance checks.

## Build

Build the Rust client and generate bindings before opening Xcode:

```sh
bash scripts/build-native-core.sh ios
open Project.xcworkspace
```

Use the `ZRemote App` scheme. The script produces the required
`native/artifacts/zeron_coreFFI.xcframework` with iOS device, simulator, and host
macOS slices. Missing native artifacts fail package resolution. There is no
production fallback that silently replaces a live account with demo data.
The default Xcode action builds iOS independently. Android is built explicitly
below; after configuring both native cores, `SKIP_ACTION=launch` can opt into
Skip's combined device workflow.

For Android, `bash scripts/build-android.sh` builds the client core, resolves
dependencies, generates full notices, verifies them, and assembles a debug APK.
It does not install or distribute it. The custom Skip Gradle hook builds the Swift
module separately for arm64-v8a and x86_64, linking each architecture's Rust `.so`.
Both platforms use the same generated UniFFI Swift interface and client behavior.

When explicitly requested, CI also exports standalone Gradle sources alongside
its debug APK. The export omits native build directories: local Windows assembly
must recover the already compiled Swift/Rust JNI libraries from that exact APK
and disable Skip's native rebuild. This validates local Kotlin/APK assembly, not
Windows Swift/Rust compilation. Keep local Gradle workers and memory bounded;
Skip's exported default heap settings must not override the shared profile.

The manual `Android Compile Check` workflow runs this exact script on a standard
`macos-26-intel` runner (14 GB), using Skip 1.9.12, Java 21, Gradle 9.2.1, Android platform 36,
build tools 36.0.0, Swift Android SDK 6.3.3, NDK r27d, and cargo-ndk 4.1.2. The
matching Swift 6.3.3 host/Android pair avoids Swiftly 1.1.3's incorrect 6.4.0
host download URL normalization. The setup helper retries installer download
timeouts up to three attempts, then verifies the NDK and matching toolchain;
the retry delays are 15 and 30 seconds, and other errors stop immediately.
Full iOS builds also use the standard 14 GB
Intel runner: the 7 GB ARM runner timed out waiting for admission after Android
tool setup. Admission still requires 3 GB available memory, uses one
worker, and retains the shared cache and provenance checks. Rust cache paths are
computed relative to `native/core`, as required by the cache action, while builds
use the shared `~/.cache/ZRemote/cache/cargo` directory. Android's first cold build
has a bounded 180-minute job timeout. It
produces a debug build in the temporary runner workspace and retains the compiler
log by default. Its `save_debug_apk` input defaults to false; explicitly enabling
it retains the successful debug APK for one day for local testing. It does not
install the app, use release credentials, or run device tests. Building and saving
that APK require the user's explicit request. Before it is registered on main, dispatch
`iOS TestFlight` with `operation=compile` and `platform=android` or `both`; that
mode skips the entire signing job. See [manual compilation](TESTFLIGHT.md).

After these workflows reach `main`, `iOS Compile Check` can also be dispatched
directly with `platform=android` or `both`. It calls the same Android workflow
as a reusable job; `save_debug_apk` remains opt-in. All entry points require
manual dispatch and never run automatically on a push or pull request.
Each app build job also checks `github.event_name == 'workflow_dispatch'`, so a
future automatic caller cannot start it through `workflow_call`. The reusable
workflow sees the [original caller's GitHub context](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#github-context).
The automatic CI workflow runs domain/projection regressions and source syntax
checks; it does not invoke app compilation or TestFlight.

The SDK installation command and matching NDK are verified against
[Skip 1.9.12's installer implementation](https://github.com/skiptools/skipstone/blob/584e579ea2e73cdcb51f61cef853b6d6b16291a6/Sources/SkipBuild/Commands/AndroidCommand.swift#L334)
and [Swift's Android SDK instructions](https://www.swift.org/documentation/articles/swift-sdk-for-android-getting-started.html).
The bootstrap sequence follows [Skip's pinned CI setup](https://github.com/skiptools/skipstone/blob/584e579ea2e73cdcb51f61cef853b6d6b16291a6/.github/workflows/ci.yml#L145).
Android command-line tools use Google's separate Intel/ARM Mac archives with
the [published SHA-256 checksums](https://developer.android.com/studio#command-line-tools-only).

## Targeted checks

Run only named tests relevant to a change. The dependency-free domain manifest is
selected with `ZREMOTE_CORE_ONLY=1`, for example:

```sh
ZREMOTE_CORE_ONLY=1 python3 scripts/run-local.py --phase swift -- \
  swift test --jobs 1 --filter CoreBehaviorTests
```

On this Windows machine, the portable Swift 6.4 compiler can syntax-parse explicitly
listed files with `scripts/parse-swift.ps1 -Path file1.swift,file2.swift`. Syntax
parsing does not validate imports, types, linking, gestures, or device behavior.
Full app compilation and phone/tablet device checks must be reported separately.

The user-local Windows setup also includes the official Windows SDK and VC headers
and libraries. Select it with `. ./scripts/swift-environment.ps1`. Targeted XCTest
commands use `swift test --build-system native --jobs 1 --filter CLASS_NAME`
through `run-local.py`, with a shared scratch path under
`$env:LOCALAPPDATA/ZRemote/cache/swift-core-native`. Swift 6.4's default SwiftBuild
backend failed to emit compiler diagnostics in this portable setup; the native
backend compiles, links, and runs the tests. Its deprecation warning and failure
to create the optional `debug` symlink do not prevent the tests from running.

After regenerating bindings, `powershell -File scripts/typecheck-native-windows.ps1`
checks the actual adapter against the generated C module and pinned SkipKeychain
source. It checks types, not linking or platform secure-storage behavior; upstream
SkipKeychain deliberately throws on this unsupported host platform.

CI runs the three named Swift regression classes and the three Rust transcript
projection regressions. Five isolated installer cases use stub commands to
check retries and failure propagation without downloading an SDK or compiling.
Run those cases with `bash Tests/Scripts/install-android-toolchain-tests.sh`.
Six additional scoped cases check quiet-child liveness, exit status propagation,
the combined host build, all required iOS framework slices using stub tools, and
TestFlight cleanup with incomplete logs:
`python3 Tests/Scripts/test_run_local.py` and
`python3 Tests/Scripts/test_build_native_core.py`, plus
`python3 Tests/Scripts/test_testflight_cleanup.py`. They do not compile an app.
The iOS Compile Check remains a separate manual unsigned
app build; TestFlight remains a separate manual distribution workflow.

The iOS build and archive commands pass `-skipPackagePluginValidation` and
`-skipMacroValidation` for the trusted, pinned Skip dependencies on fresh CI
runners. These command-scoped flags match
[Skip 1.9.12's app build](https://github.com/skiptools/skipstone/blob/584e579ea2e73cdcb51f61cef853b6d6b16291a6/Sources/SkipBuild/Commands/AppCommand.swift#L115-L125)
and [archive implementation](https://github.com/skiptools/skipstone/blob/584e579ea2e73cdcb51f61cef853b6d6b16291a6/Sources/SkipBuild/Commands/InitCommand.swift#L299-L311).

Skip generates the bridge while preparing either platform, including an iOS-only
build. **All shared SwiftUI views**, including nested/helper views, and their
property-wrapper storage (`@State`, `@Environment`, `@FocusState`, etc.) must use
internal or public visibility so the generated bridge can access them. Types
used in that storage must also be visible. Ordinary implementation helpers and
iOS-only UIKit representables can remain private. This applies beyond the
explicitly bridged root view; see [Skip's SwiftUI visibility rules](https://skip.dev/docs/app-development/#swiftui).
Swift syntax parsing alone does not detect a private-state bridge failure.
Kotlin-only implementation helpers whose API uses Compose types must also opt
out of native bridging with `/* SKIP @nobridge */`. For example, the composer's
visual transformation and offset mapping remain on the Kotlin side, while its
`ContentModifier` exposes the supported boundary to native Swift. Otherwise
bridge generation rejects Compose-only types such as `TransformedText`, even
when the app target is iOS. See [Skip's bridge directives](https://skip.dev/docs/platformcustomization/#skip-comments).

Native notification delegate completion handlers retain the SDK's `@Sendable`
annotation so the tap handler can finish after routing on the main actor under
Swift 6 concurrency checking. Keep that annotation when changing these callbacks;
see [Apple's delegate signature](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate/usernotificationcenter(_:didreceive:withcompletionhandler:)).
Shared controls also retain `@MainActor` on actions passed to native UIKit controls.
The root layout and its concretely typed presentation bindings are separate
expressions to keep SwiftUI typechecking bounded as routes are added.
Use an inline setter closure when a `Binding<Bool>` invokes a main-actor model
method. Passing the method reference directly triggers an IRGen crash in the
Swift 6.3.3 Release compiler; see [Swift issue 88027](https://github.com/swiftlang/swift/issues/88027).

The iOS Compile Check retains `ios-dependency-evidence` for one day after its
resolve/build attempt. It contains the workspace `Package.resolved`, generated
Swift acknowledgements, and full Swift dependency license texts when available.
Review and commit the resolved workspace lockfile after the first successful
resolution and whenever package dependencies change.

The native shell was adapted from Skip's Howdy app at
`bdcae70f50cf388caae99cd69c24df8366e2808a` using its established project layout.
