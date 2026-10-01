# Native development

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
the NDK used by the Swift Android SDK. Dependencies are pinned in `Package.swift`
and the Rust lockfile. Preserve generated Swift package resolution when updating
dependencies; regenerate acknowledgements with the resolved versions.

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
`macos-26` runner, using Skip 1.9.12, Java 21, Gradle 9.2.1, Android platform 36,
build tools 36.0.0, Swift Android SDK 6.3.3, NDK r27d, and cargo-ndk 4.1.2. The
matching Swift 6.3.3 host/Android pair avoids Swiftly 1.1.3's incorrect 6.4.0
host download URL normalization. It
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

CI runs the two named Swift regression classes and the single Rust transcript
projection regression. The iOS Compile Check remains a separate manual unsigned
app build; TestFlight remains a separate manual distribution workflow.

The iOS Compile Check retains `ios-dependency-evidence` for one day after its
resolve/build attempt. It contains the workspace `Package.resolved`, generated
Swift acknowledgements, and full Swift dependency license texts when available.
Review and commit the resolved workspace lockfile after the first successful
resolution and whenever package dependencies change.

The native shell was adapted from Skip's Howdy app at
`bdcae70f50cf388caae99cd69c24df8366e2808a` using its established project layout.
