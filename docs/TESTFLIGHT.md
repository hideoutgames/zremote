# TestFlight and manual compilation

The retained `.github/workflows/ios-testflight.yml` is manual dispatch only and
uses standard 14 GB `macos-26-intel` runners. Its `operation` defaults to `testflight` to
preserve the existing distribution workflow. Merging a branch does not upload.
App compile and TestFlight jobs additionally require a `workflow_dispatch`
origin, including calls through reusable workflows. Automatic regression CI
does not call either app compilation or distribution.

For unsigned compile validation, explicitly select `operation=compile` and
`platform=ios`, `android`, or `both`. Compile mode calls the reusable
`ios-compile.yml` workflow; the entire TestFlight job is skipped, so it does not
enter the signing environment, read App Store Connect secrets, or upload to Apple.
The workflow name alone does not identify a TestFlight attempt: a compile-mode
failure leaves the TestFlight job intentionally skipped. Check the operation
and failed job before treating it as an archive, signing or upload problem.
To validate an iOS build before distribution, use the unsigned compile entry:

```sh
gh workflow run ios-testflight.yml --repo hideoutgames/zremote --ref BRANCH \
  -f operation=compile -f platform=ios
```

Enable `save_debug_apk` only for explicitly requested local Android testing. It
retains the debug APK for one day, without installing or distributing it.

Android demo screenshots use `operation=screenshots` and `source_run_id` for a
successful Android build. That mode runs an Android emulator on an Ubuntu runner
and skips the entire TestFlight job. Screenshot evidence records the build
revision and APK hash; Windows APK assembly is a separate validation result.

`operation=testflight` retains the `testflight` environment and current secrets:
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (PEM or base64), and
`APPLE_TEAM_ID`. The optional `IOS_BUNDLE_ID` defaults to `no.hideout.zremote`.
This operation still requires an explicit distribution request.

The native preparation builds the Rust peer and Skip Swift package, generates
Swift/Cargo acknowledgements, and archives `Project.xcworkspace` with the
`ZRemote App` scheme for generic iOS devices. The archive stays unsigned;
export uses automatic cloud distribution signing with the team's existing
Apple Distribution certificate. It does not create development certificates.
The next build number exceeds both the highest existing App Store Connect
build and the workflow run number. After upload the workflow waits for a
VALID processing result, refreshing its short-lived API token as needed.
Temporary key material is removed, and logs are checked before artifact upload.

## Build progress, caching, and failures

Both iOS workflows use the Rust cache `shared-key` value
`ios-core-mobile-dist-v2-testflight`. It preserves the existing TestFlight cache
identity while allowing the unsigned compile job to reuse it. The cache action
still separates architecture, Rust toolchain, environment, and dependency inputs.
GitHub permits restoring the current branch or default branch's cache; a build
on `main` cannot reuse a cache created only on a feature branch. See the
[cache action configuration](https://github.com/Swatinem/rust-cache#example-usage)
and [GitHub cache restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

Cold native preparation has taken 94 minutes on the standard Intel runner.
TestFlight therefore has a four-hour job budget; unsigned compilation has three
hours. Native core compilation is bounded to two hours, package resolution to
20 minutes, acknowledgements to five minutes, and the app build/archive to one
hour. TestFlight allows 30 minutes for export/upload and 35 minutes for the
existing 30-minute processing poll. These are upper bounds, not expected warm
build times. Cargo and Xcode workers remain one.

Native compilation, package resolution, and acknowledgements appear as separate
Actions steps with separate retained logs. Native compilation reports timed
host/bindings, device, simulator, and XCFramework phases. The shared runner emits
a liveness message every minute while its child is running; this is not proof
that a compiler is making progress. The host peer and binding generator compile
together to avoid building their common dependency graph twice. The device,
simulator, and host slices are still all included for Skip package resolution.

Archive output is quiet so verbose plugin descriptions do not bury the actual
diagnostic. On failure, download `testflight-logs` and inspect the failed stage's
log (`native-core.log`, `package-resolve.log`, `acknowledgements.log`, `build.log`,
or `export.log`). A failure before export means nothing was uploaded to Apple.
For example, run `36903705692` completed Rust preparation but failed bridge
generation because shared SwiftUI state was private. All shared views and their
property-wrapper storage must be visible to Skip, even for an iOS-only build;
see [the shared view rules](BUILD.md#targeted-checks).

Source validation is not evidence of successful Apple signing or upload.
Report each actual compile, signing, upload, and processing result separately.
