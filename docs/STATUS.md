# Implementation and verification status

The replacement was merged into `hideoutgames/zremote:main` in
[PR #175](https://github.com/hideoutgames/zremote/pull/175). Follow-up platform
build fixes and Android visual validation are tracked in
[PR #176](https://github.com/hideoutgames/zremote/pull/176). The replacement
incorporates main's TestFlight safeguards. App compilation and device results
are recorded separately from the completed domain checks below.

## Implemented source

- Swift/Skip app shell, charcoal palette, Composer, Sessions, phone side drawer,
  tablet side panel, phone bottom sheets, and centered tablet secondary views.
- Host-backed native peer, system-browser sign-in, secure credentials, account
  isolation, durable delivery retry, streaming projections, and local drafts.
- Host-authoritative model picker, favorites, provider locking, reasoning/options.
- Project selection and creation using existing host commands; remote browsing
  only for choosing a project's folder.
- Completed-turn file cards, six-file preview, saved per-file native diffs, and
  PR metadata with browser links supplied by Zeron.
- Optional blank-Composer background, Settings/Acknowledgements, offline demo.
- Native expanding session search, profile/account menu, nested sorting/filtering,
  haptic session/message menus, and full-page phone Settings.
- Native file/photo/camera import, removable composer attachments and inline chat
  previews; host-backed command/skill/file suggestions with highlighted references.
- Left-aligned user messages, selectable agent text and copyable code blocks;
  inline sub-agent status and observed PR cards with a PR information drawer.
- Native iOS/Android entry points, pinned Rust subset, license inventory tools,
  a shared local build runner, and adapted manual TestFlight workflow.

The previous tracked React Native app and its source, assets, patches, and docs
have been removed. The app icon and TestFlight identity/configuration are retained.
The local `upstream` remote is removed. GitHub's fork relationship remains; server
detachment can discard repository metadata and has not been performed.

## Verification

Local checks completed on 2026-10-01. These are separate from an app build and
device validation. No full suite or coverage sweep was run.

| Check | Result and scope |
| --- | --- |
| `CoreBehaviorTests` | 11 passed with stable inputs. Includes the prior 8 behaviors plus attachment-only send/stale picker handling, pin/archive state, and observed PR anchors/state updates with old-preference migration. |
| `ChatTextBehaviorTests` | 3 passed with stable inputs: UTF-16 caret replacement, token boundaries/quoted filenames, and byte-preserving code fences including CRLF and unfinished streams. |
| `UnifiedDiffParserTests` | Final targeted rerun: all 6 passed after correcting Swift exclusivity and CRLF handling. Includes immutable per-file capture and bounded/binary/partial diffs. |
| Rust projection regressions | The 3 named cases in `client_ffi::session::projection_regression_tests` passed, 22 filtered, stable inputs. Covers reasoning exclusion, attachment trailer/metadata separation, and actual running sub-agent status after spawn resolves. |
| Native Swift adapter | Swift 6 semantic check passed for the real core module, pinned SkipKeychain source, regenerated UniFFI Swift, and C header/module map. Windows uses SkipKeychain's unsupported-platform branch; this does not verify mobile secure storage. |
| Changed presentation files | 15 explicitly selected Swift UI files passed syntax parsing after the interaction changes; editor/chat fixes were parsed again after review. This does not validate SwiftUI/Skip platform types or runtime behavior. |
| Notices | Source and 339-entry Cargo inventory audits passed. Complete Swift and Gradle inventories require platform resolution. |
| Build/configuration | Bash scripts, workflow/Skip YAML, plist/XML, asset JSON, and owned-source whitespace checks passed. Upstream license text is preserved verbatim. |

The shared runner records local evidence under the machine's ZRemote cache.
The Core/ChatText test result is `c409888b-accd-4f35-b17d-0bc1d69f0e8d`; parser rerun is
`a3607b6b-0376-467b-8c32-006918426a31`; native adapter typecheck is
`3984fe39-a0de-4af9-8539-27c9033a2db7`; Rust regression is
`ab1f5f59-70bf-4e69-92ab-ed1faad6a9a4`. The generated ABI was rebuilt from the
extended native core, rather than hand-written to match the adapter.

- No iOS or Android application build, emulator/device run, live login, host
  roundtrip, or TestFlight upload has been verified for this replacement.

## Platform boundary and remaining checks

JDK 21, Android SDK 36, platform/build tools, and Gradle 9.2.1 are installed locally.
The complete Skip Fuse build requires macOS/Xcode for its SwiftUI prebuild; the
Windows SDK installation alone cannot produce a validated app. No Android device
is connected. The installed Windows emulator failed to boot API 36 and API 28
images without acceleration; no Windows feature changes or reboot were made.
The [standalone assembly](ANDROID_LOCAL_BUILD.md) and
[cloud screenshot](ANDROID_VISUAL_CHECK.md) workflows keep those validation
results separate.

Before merging, compile both native app targets on a supported Mac and exercise
demo mode on iPhone/iPad and Android phone/tablet sizes. Validate live sign-in,
streaming/stop/reconnect/retry, project creation, captured diffs, background-only
decoration, accessibility, keyboard behavior, and scrolling during long turns.
Generate and audit the resolved Swift/Gradle notices before any distribution.

The transcript uses stable, incremental native-core projections and a shared
SwiftUI/Skip renderer. It does not yet use the official iOS app's analytic CoreText
renderer; equivalent long-session performance has not been established.

Android uses one large native sheet detent, a supported gesture overload, a lazy
scroll target, and custom Compose text-selection/back-handler components to cover gaps in
the pinned Skip API. iOS retains native sheet detents and text selection. These
adaptations have been checked against dependency source; device behavior remains
part of the outstanding platform validation.

Host turn snapshots can expire, and simultaneous checkout edits may be included.
The client cannot create an arbitrary Desktop folder with the existing API.
PR review opens the host-provided web link; there is no direct GitHub integration.
