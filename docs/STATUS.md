# Implementation and verification status

## Agent question flow

Pending agent input now takes the Composer's place in a rounded, theme-aware
card with its provider icon. Questions appear one at a time with wrapped,
full-width choice rows, radio/check indicators, Back/Next, and optional custom
text. Multiline answers retain their keyboard newline. Answer drafts survive
question navigation and failed queue attempts; the separate Composer draft and
attachments are retained. Bounded scrolling keeps long questions usable, with a
whole-card scroll fallback when the keyboard or large text leaves little room.
Opening Sessions or another view dismisses question editing.

The final action requires an answer to each question. Single-choice custom text
replaces the choice; multiple-choice custom text is additive. Blank/duplicate
choices and malformed question IDs cannot produce invalid answer dictionaries.
Submission captures the session and complete request schema, rejects duplicate
sends, and isolates late results after session, schema or account changes.
An accepted local queue call shows `Answer queued` until the peer changes or
clears the input. This is not a host-execution acknowledgement; the current peer
does not expose delivery acknowledgements for this command. No host change is
required.

Targeted domain checks on 2026-10-01: all six `QuestionAnswerDraftTests` and
four `QuestionAnswerSubmissionTests` passed, including retry, duplicate sends,
synchronous question resolution and stale-session/account replies. Shared
runner result `490c2e7f-927d-4768-96f8-8c3966631879` had stable inputs.
The three changed/new presentation files passed Swift syntax parsing. This
does not typecheck SwiftUI/Skip or validate keyboard behavior, scrolling,
accessibility and appearance on devices. No application build, workflow dispatch
or distribution was run for this change.

## Full-window phone drawer and swipe intent

The phone drawer now moves the main page's full-window surface, including its
top and bottom safe-area backgrounds, over a full-window Sessions underlay.
Its reveal is 80% of the window with 56-point continuous corners. Root-measured
safe-area padding is restored inside each layer before clipping/movement;
keyboard avoidance and the separate tablet side panel are retained. This is an
independent implementation of the interaction described by
[SwiftSideDrawer](https://github.com/cynicalight/SwiftSideDrawer); its code is
not incorporated.

iOS keeps the corner radius fixed throughout the position animation, becoming
square only when closed. Android uses its native rounded-shape interpolation;
the pinned Skip bridge does not forward custom shape animation data.

Opening uses a broad leading-edge region (up to 200 points); closing works over
both Sessions and the exposed main page. Native recognizers require clear
horizontal intent, and commit only with 30% travel or a deliberate, sufficiently
long flick. iOS rejects native controls, editors, active selection, horizontal
scrolling and presented controllers; its touched vertical scroll waits for the
drawer direction decision so a close swipe cannot also trigger refresh.
Android gives child-consumed movement priority and rejects held touches.
Cancellation, multi-touch, rotation, route changes and right-to-left direction
are handled explicitly. No invisible edge overlay intercepts ordinary taps.

All six `DrawerGestureRulesTests` passed with stable inputs on 2026-10-01
(`f60af7d8-f719-4b87-8e1f-e5ad5295cd5a`). The four changed/new presentation files
passed Swift syntax parsing. These checks do not establish native gesture
arbitration, keyboard layout, animation feel or device appearance. No application
compilation, workflow dispatch or distribution was performed for this change.

## Sessions refresh and haptics

Sessions now uses native pull-to-refresh: a transparent UIKit refresh control
on iOS and Material's nested-scroll refresh state on Android. The revealed
surface shares the Composer's full-window wallpaper coordinates, effect and
contrast treatment, with a darker overlay and inset shadows. No image produces
a slightly darker page surface. The existing agent activity glyph is reused
without changing its appearance or animation. Short/empty lists remain pullable.

Refresh requests use the existing mobile peer; concurrent requests coalesce,
composer state is preserved, and account changes discard stale failures. The
live peer requests resync and republishes its current snapshot; later network
events can arrive after the indicator settles. No host or relay change is needed.

Settings has one subtitle-free Haptics toggle, enabled by default and stored
per account. It gates app-triggered refresh feedback and Android's app-context
menu feedback. OS-owned haptics (including UIKit Haptic Touch) still follow
system settings; no private API is used to intercept them.

Targeted local checks on 2026-10-01: all four `SessionsRefreshTests` passed
(snapshot updates/draft preservation, concurrent failure/retry, stale-account
completion and cancellation). All three `CoreBehaviorTests.testHaptics…` cases
passed (legacy defaults/opt-out roundtrip, account isolation and restore/sign-out).
Shared runner results: `138464ab-d531-42e9-9dd2-2a9499ce2573` and
`9ca91f96-9a71-4d43-a902-2cfc6208c4a6`; both had stable inputs.

Changed presentation files passed Swift syntax parsing. This does not typecheck
UIKit/SwiftUI/Skip or validate gestures, wallpaper alignment, haptic feel and
VoiceOver on a device. No full test suite, app build, workflow dispatch or
distribution was run. Compile and TestFlight workflows remain manual-only.

## Manual build failure investigation

[Manual compile run 36883320315](https://github.com/hideoutgames/zremote/actions/runs/36883320315)
failed at two separate stages. iOS reached Skip bridge generation and rejected
the private `model` and `scenePhase` storage in `ZRemoteRootView`. Those properties
are now internal, matching the generated bridge's access requirement. Android
stopped in SDK setup because the NDK r27d download timed out after about 60
seconds; setup now has a bounded retry for download timeouts and still checks
the installed NDK/toolchain before continuing.

[Earlier compile run 36876051092](https://github.com/hideoutgames/zremote/actions/runs/36876051092)
hit the same root-view bridge error on both platforms. Its missing generated
Android settings file was downstream of that error.
[Run 36870365505](https://github.com/hideoutgames/zremote/actions/runs/36870365505),
despite the older "iOS TestFlight" workflow name, selected Android compile mode:
TestFlight was intentionally skipped. Its earlier resource-admission timeout
was addressed by the existing Intel runner migration; resource limits are
unchanged. No current signing/upload failure was observed in these runs.

The compile and TestFlight jobs remain manual-only and now reject automatic
callers explicitly, including reusable workflow calls. Automatic regression CI
retains its existing checks and adds five isolated installer cases that use
stub commands, with no SDK download or app compilation. No workflow was dispatched or rerun during this investigation;
successful app compilation and TestFlight distribution remain unverified.

Local validation for these fixes: the changed root view passed Swift syntax
parsing; the installer and its test script passed Bash syntax checks; all five
stub installer cases passed (success, timeout recovery, permanent failure,
exhausted retries and timeout followed by permanent failure). Actionlint 1.7.12
passed on the four changed workflow files with external ShellCheck/Pyflakes
disabled. No domain suite, native app build, signing or upload was run.

## Follow-up interaction refinements

The follow-up to merged [PR #177](https://github.com/hideoutgames/zremote/pull/177)
adds room above provider tabs, pushes folder browsing onto its own project
drawer page, and distinguishes registered folders from new project choices.
The Show submenu filters to one project without headers; Show all supports
animated project collapse. Sidebar PR badges display just the icon and number.
UIKit owns the fixed-size profile/PR menu buttons and their Liquid Glass
presentation; native PR action images retain their state colors in either theme.

User messages align right. iOS agent prose/code uses a noneditable, non-scrolling
UITextView for native range selection, preserving the active range during
streaming updates and retaining inline formatting/links. Android keeps Compose
selection. iOS 26 registers the chat header using Apple's
[safe-area bar](https://developer.apple.com/documentation/swiftui/view/safeareabar(edge:alignment:spacing:content:))
and [soft scroll edge effect](https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle/soft),
without a second material layer over the header. Older iOS retains the material
fallback; Android's existing blur limitation below still applies.

Settings offers persisted System/Light/Dark themes. Named colors, wallpaper
contrast and the lower chat fade follow the appearance. Usage bars use neutral
grays. Device status keeps its text and drops the extra dot; decorative Settings
footers and the redundant sub-agent heading are removed. The temporary local
notification limitation remains documented in code and the README.

A fresh, unambiguous low-quota observation now retains its session, provider,
host and account identity. Its banner stays visible until dismissed, across
navigation, quota recovery and unavailable later samples. Dismissal applies to
the original warning, never the currently selected session. Preferences and
retained warnings stay isolated between live accounts and demo mode.

### Follow-up verification (2026-10-01)

| Check | Result and scope |
| --- | --- |
| Domain regressions | `UsageNotificationTests` (14) and `ProjectFolderRulesTests` (3) passed, 17 total, with stable inputs. Only the 3 folder cases were rerun after the Windows network-path correction; that rerun also passed with stable inputs. |
| Presentation source | 18 explicitly changed/new UI Swift files passed syntax parsing; later edits were reparsed only for affected files. This is not SwiftUI/UIKit/Skip typechecking or device validation. |
| Theme assets | All 10 named colors and references validated. Primary/secondary text and PR state text meet 4.5:1 in the checked light/dark surface combinations; color values were adjusted after the initial contrast check found failures. |
| Notices and docs | Checked-in-source license audit, local documentation links and changed-file whitespace checks passed. No dependencies or generated native bindings changed. |

Shared result IDs: `cc979312-d40e-475a-a2f6-09b91333af8d` (17 domain cases) and
`56acd923-9f9a-4d8e-b725-1906e6d2971f` (folder-only rerun).
No full suite, iOS/Android app build or device run was performed. Native menu
morphing, selection handles, scroll blur and navigation still need platform
validation; the earlier adapter/build results below do not verify this UI.

## Model, session and settings refinement

PR #177 adapted the native Hideout Games model picker, including
provider marks, favorites, effort/Fast settings and offline Fusion options.
Session rows use state indicators, an inline Composer icon and latest observed
PR badge. Compact View removes only the activity/known completion-age line.
PR cards and the information drawer share the same state colors and branch
presentation. The iOS profile menu styles the native control with Liquid Glass.

Background uploads are downsampled, account-local and rendered with the pinned
core's Dither/ASCII/Halftone/Scanlines effects and contrast guard. Settings exposes
connected devices, read-only provider accounts and plan usage. The quota banner
uses the most restrictive valid window of the matching active account; stale,
errored and ambiguous quota data never raises a new warning.

Notifications are intentionally a **temporary mobile-only implementation**, as
requested. They use device-local alerts for peer-observed questions, successful
turns and one quota-threshold crossing per session. They do not depend on Zeron's
APNs service. Reliable delivery while the app is suspended/terminated remains
out of scope until an independent service exists. Demo never schedules alerts.

The original iOS chat chrome used a masked material above the transcript and a
black fade behind the Composer. The pinned Android UI layer does not implement unclipped
scrolling, safe-area insets or Gaussian material blur, so Android retains its
native keyboard layout with a translucent lower fade. The iOS Fusion popover
uses an in-picker card on Android, where popovers are unsupported.

The host's current PR metadata has no draft flag. Draft presentation is supported
when supplied, but the app never guesses draft status or queries GitHub itself.
Historical completion time is shown only when verified completion data exists;
general message/update timestamps are not relabeled as completion times.

No iOS/Android app build or device validation is being run for this refinement,
per request. The targeted checks for this branch are recorded separately below;
the older replacement checks do not validate these changes.

### Refinement verification (2026-10-01)

| Check | Result and scope |
| --- | --- |
| Domain behavior | 32 distinct tests passed: `CoreBehaviorTests` (11), `ModelPresentationTests` (5), `SessionPresentationTests` (5), and `UsageNotificationTests` (11). After notification review, only the 11 notification cases were rerun; the final question-identity fix reran its one affected case. All runs recorded stable inputs. |
| Bundled Rust peer | Two targeted, single-worker core builds and actual UniFFI generation passed with stable inputs. The final generated Swift/C ABI includes account usage and successful-turn signals. No host or relay source changes are required. |
| Native Swift adapter | Windows semantic check passed with stable inputs against the core module, generated Swift/C bindings, pinned SkipKeychain and `NativeClient`. iOS-only notification delivery is excluded from this check. |
| Presentation and notifications | Explicitly changed Swift files passed syntax parsing. This does not verify SwiftUI/Skip platform types, iOS notification APIs, visual behavior or device delivery. |
| Assets and notices | Nine provider assets and their JSON validated; provider images visually inspected. The checked-in-source notices audit, changed documentation links and whitespace checks passed. No dependency inventory changed. |

The shared runner's local result IDs are `06d0eee5-459a-4a9e-9e97-4393e69b140d`
(initial domain run), `de55571e-8bdc-4542-94a2-7250bc2a3159` (notification rerun),
`76184c9b-6594-4983-9ed8-fd54a8019821` (final identity regression), and
`f5622476-3371-4cf3-b449-0a9c4b9a393c` (native adapter). Final Rust build/codegen:
`d01262b2-4bd8-42d4-83a6-9ec158380dcc`.

### Earlier replacement baseline

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
- Right-aligned user messages, selectable agent text and copyable code blocks;
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
