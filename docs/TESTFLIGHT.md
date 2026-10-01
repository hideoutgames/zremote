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
Before the new compile workflows reach main, use this existing registered entry:

```sh
gh workflow run ios-testflight.yml --repo hideoutgames/zremote --ref BRANCH \
  -f operation=compile -f platform=both -f save_debug_apk=true
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

Source validation is not evidence of successful Apple signing or upload.
Report each actual compile, signing, upload, and processing result separately.
