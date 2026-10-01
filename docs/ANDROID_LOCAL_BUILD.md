# Local Windows Android assembly

The native Skip prebuild and Swift/Rust Android compilation run on macOS.
Windows can compile Kotlin, process resources, produce dex, and assemble the
debug APK from the official standalone export plus the matching native libraries.
This does not claim that Windows compiled the native Swift/Rust app from source.

After an explicitly requested Android compile finishes with `save_debug_apk`
enabled, run in PowerShell:

```powershell
. ./scripts/android-environment.ps1
python scripts/assemble-exported-android.py --build-run-id RUN_ID --expected-head FULL_40_CHARACTER_SHA
```

The helper downloads only `zremote-debug-apk` and `zremote-standalone-sources`
from that exact run in `hideoutgames/zremote`. It checks repository, commit,
artifact identity and hashes, then creates an isolated directory under
`%LOCALAPPDATA%/ZRemote/exports`. Expired, absent, mismatched, or ambiguous
artifacts fail before compilation. SDK paths are adjusted only in that export.

It stages every Android native library from the Mac APK into the generated
ZRemote module's verified `build/jni-libs` folder. SkipBridge's
`SKIP_BRIDGE_ANDROID_BUILD_DISABLED=1` prevents its JNI merge dependency from
requesting native recompilation. A temporary Gradle init script additionally
disables only the two native Swift build tasks; Kotlin, resource, dex and APK
tasks stay enabled. Our custom task action does not remove SkipBridge's separate
dependency guard. See the [resolved SkipBridge 0.18.0 implementation](https://github.com/skiptools/skip-bridge/blob/0.18.0/Sources/SkipBridge/Skip/skip.yml#L40).

The actual build is admitted through `scripts/run-local.py`, uses the shared
Gradle cache, one worker, a 1536 MB JVM heap, 384 MB metaspace, and the in-process
Kotlin compiler. The limit overrides the larger default heap added by upstream
export. A one-hour timeout stops only this build's process tree.
Admission logs report measured available memory, the configured minimum,
the current build owner, and how many requests are ahead. A queue timeout is a
resource admission failure; it does not mean the application compiler ran.

`windows-assembly.json` records exact source and artifact identities, helper and
tool versions, source hashes before/after, APK hashes, and exit status. Successful
validation also requires the final APK's native libraries and assets to match
the source APK. `windows-assemble.log` contains the compiler output. Read both
the shared runner result and this report; stale, failed or partial checks are
not passing builds. Neither assembly nor the helper installs or publishes an app.

For genuine screenshots, use the separately authorized
[demo visual check](ANDROID_VISUAL_CHECK.md), which identifies its cloud emulator
and source APK independently from this Windows build.
