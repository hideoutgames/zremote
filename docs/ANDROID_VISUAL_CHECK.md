# Android demo screenshots

`Android Demo Screenshots` is a manual/reusable workflow. It installs one
previously compiled debug APK on a standard Ubuntu KVM emulator running API 36.
It does not build, authenticate, connect a remote computer, or run a test suite.
Dispatch it only when device captures are explicitly requested.

Supply `build_run_id` for the completed Android compile run that saved
`zremote-debug-apk`. The optional `expected_head_sha` adds an explicit source
commit assertion. The workflow checks the selected run, repository, artifact
identity and source SHA before download, then records the APK SHA-256 and helper
revision. An expired or missing artifact fails before emulator startup.

The bounded `scripts/capture-android-demo.py` helper clears only this app's data
on the isolated emulator and selects **Try test mode**. It captures Composer,
model picker, Sessions, Settings, a sample conversation, completed-turn file
summary, all changed files, and a native file diff. Each tap is located using
the current Android accessibility tree. Screenshots are direct ADB PNGs, with
their observed accessibility trees beside them; no pixels are generated or
edited. Missing controls fail the affected layout and the workflow reports that
failure instead of treating partial captures as a passing visual check.

Phone uses 1080 × 1920 pixels at 420 dpi; tablet uses 1920 × 1200 pixels at
240 dpi, producing a smallest width above 600 dp. Layouts run sequentially on
one emulator with one virtual CPU and 3 GB RAM. The helper has a twelve-minute
overall limit. Artifacts are retained for one day.

Inspect `capture-results.json` before presenting any capture as verified.
`source-run.json` and `apk.json` identify exactly what ran. These are screenshots
from a cloud emulator, separate from [local Windows Kotlin/APK assembly](ANDROID_LOCAL_BUILD.md) of the
same exported sources and native libraries. They do not establish iOS behavior,
real host integration, animation smoothness, or performance on physical devices.

The implementation follows the official
[emulator action configuration](https://github.com/ReactiveCircus/android-emulator-runner)
and [cross-run artifact download API](https://github.com/actions/download-artifact/tree/v4).
