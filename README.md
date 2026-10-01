# ZRemote

A focused native Zeron peer for iPhone, iPad, and Android, built with Swift,
SwiftUI, Skip Fuse, and Zeron's Rust mobile core. Agents and project operations
execute on your remote computer. The mobile app never runs an agent or shell.

The Composer is the main view. Phones slide it aside to reveal Sessions;
tablets use a side panel. Model selection, project creation, PR information,
and changed-file details open in phone bottom sheets or centered tablet modals.
Settings is a full-page phone modal. Native account, filtering and session menus
keep the sidebar compact. Model modes and effort controls remain in the picker.

The phone drawer moves the entire Composer/chat page, including its safe-area
backgrounds, over a full-window Sessions layer. It reveals 80% of the screen
with large continuous corners and a spring settle. Swipe right from the broad
leading edge to open, or left across Sessions/the exposed page to close
(directions mirror in right-to-left layouts). Short flicks and predominantly
vertical drags do not toggle it; scrolling, refresh and text-selection gestures
keep their own interaction. Tablets retain their Sessions side panel.

The picker follows Zeron's compact provider tabs, favorites and scoped search,
using original provider marks in the picker and Composer. The Composer includes
the effective reasoning level and Fast mode. Test mode includes Claude Code,
Codex and the configurable Devin Fusion fixture.

Session rows show state (orange awaiting a response, blue finished/unread,
gray read/idle, red error), a smaller working animation, and the latest observed
PR's state badge. Compact View hides only the activity/completion-age line.
The Show menu can restrict the list to one project without category headers;
in Show all, project headers expand and collapse their sessions, with the animated
chevron immediately after the project name, separated by an 8-point gap. Sidebar PR
badges contain the state-colored icon and number. Native iOS PR menus retain
those icon colors, and the account menu uses the same control size as its peers.
On iOS 26, the project-list button uses a native Liquid Glass button. Account
initials/photos and PR symbols are native button content so they follow the
button as it opens its menu.
The display-options button keeps its slider icon when filters are active, with
purple applied only to the icon. Rare purple accents share the [official Zeron iOS palette](https://github.com/zeronsh/zeron/blob/main/apps/ios/Zeron/Design/Palette.swift)
(`#5B43E8` light / `#8B7CF6` dark), including existing-project folders and merged PRs.
Session rows use their provider's icon, including in test mode. Search expands
as one continuous control before focusing its editor.

Pull down at the top of Sessions to refresh, including short or empty lists.
The gesture reveals a recessed strip with the agent's working throbber and
inset edge shadows. A selected Composer image keeps its filter, full-window
scale and position, with a darker overlay; otherwise the strip uses a slightly
darker page background. Refresh asks the existing peer to resync, and further
remote updates can arrive after the gesture finishes.

The composer supports native file/photo/camera attachments and host-backed
`/commands`, `$skills` and `@files` suggestions. References are highlighted in
the editor and sent messages as short, color-coded labels; caret movement,
backspace and selection treat each selected reference as one unit. Drafts and
sends retain the original host reference. Suggestions filter against the current
caret query, with 32-point single-line rows in a fixed scrolling panel (up to
168 points, capped to 30% of the keyboard-adjusted viewport). Commands and skills
show `name ≈ description` with their `/` or `$` prefix and no icons; files show
a small type icon and `filename ≈ TYPE file`. Long rows truncate with an ellipsis.
User messages align right. Agent text and code use
native iOS range selection handles (Compose selection on Android); fenced code
blocks also have a Copy action. PR and sub-agent cards use only Zeron's metadata.
Sub-agent cards show only a title and state; Working uses a quiet shimmer that
stops with Reduce Motion. User-message context menus include the recorded send
time, and completed turns show their recorded work duration beneath changed
files when timing is available. No receive-time estimate replaces missing data.

The blank Composer shows the selected provider's icon above “What are we
building?” and offers both project and checkout selection. Choose the current
checkout, another existing checkout, or
New worktree. Worktree creation travels with the first message to the host;
selecting it alone creates nothing. Session actions → Details shows the thread
title (editable), project, checkout, model, host, and creation/update times.

Agent questions temporarily replace the Composer with a matching answer card.
Each question has full-width choices, an optional multiline custom answer, and
Back/Next navigation that preserves answers. The final Send answer action stays
disabled until every question is answered. The Composer draft and attachments
return when the request clears. A locally queued answer shows a compact receipt
until the peer resolves it; repeated taps and reopening the session cannot send
it twice. Failed queue attempts keep the answers available to retry.

While an agent is working, the Composer can queue the next message or steer the
current turn when the host supports it. Open the queued-message count to see
the queue. Each row has the same send button as the Composer and an adjacent
menu with Edit, Move up, Move down, and Delete. Send now steers text without
requesting an interruption; messages with attachments wait for normal delivery.
Editing acquires the host's existing edit lease, keeps the row held while the
editor is open, and preserves its attachments. Unsupported actions are disabled.

## Development

Full app builds require macOS 15+, Xcode 26+, Skip, Android SDK/NDK, Swift 6.1+,
and Rust. See [native builds](docs/BUILD.md).

Use `ZREMOTE_CORE_ONLY=1 swift test --filter UnifiedDiffParserTests` for the
focused parser/capture regressions without resolving UI dependencies.
Use the shared resource runner in `scripts/` for heavy local builds.

The manual [TestFlight workflow](.github/workflows/ios-testflight.yml) is
adapted to the native app. Implementation does not trigger an upload.

Choose **Try test mode** before signing in to exercise the same application
interfaces without credentials or network access. Its sessions, drafts, model
favorites, streaming replies, project folders, and sample changes stay in memory.

## Structure

| Path | Purpose |
| --- | --- |
| `Sources/ZRemote` | Native presentation and adaptive navigation |
| `Sources/ZRemoteCore` | Models, demo peer, diff parser, persistence |
| `Sources/ZRemoteNative` | Swift adapter to the native peer core |
| `native/core` | Pinned, attributed mobile-only Rust subset |
| `Darwin`, `Android` | Platform application entry points |
| `Tests/ZRemoteCoreTests` | Focused production regression tests |

## Compatibility boundaries

New projects can be created in the host's managed projects directory, or an
existing remote folder can be selected. The current host protocol cannot make
an arbitrary new Desktop folder. No host or edge patch is required.
Choose existing folder pushes a browser inside the project drawer. Select a
folder to enable Create project; a registered project uses a purple folder/cog
icon and Choose project, which selects it without creating a duplicate.

Turn diff snapshots are best-effort and can expire on the host. The client
captures available patches when a turn completes and retains immutable,
account-scoped revisions. Concurrent checkout edits may also appear in the
host's turn diff; it is not an audit log of agent-only filesystem activity.
Unavailable data is never substituted with a later checkout diff. Zeron exposes
the current PR for a branch, so the client retains distinct PRs as it observes
them in each session. These are first-observed positions, not historical creation
events. PR review opens the supplied HTTPS link. A missing profile photo uses
initials; the client does not look up an avatar from another service.

The optional background decorates a blank new Composer and the transient
Sessions refresh recess. It stays hidden on other surfaces. There is no terminal, general
file browser, repository administration, or direct GitHub integration.
Settings can import a device-local image and apply Zeron's Original, Dither,
ASCII, Halftone or Scanlines treatment with its native contrast guard. Images
are downsampled before account-local storage and never uploaded to the host.

Settings lists connected devices and host-reported agent accounts/plan usage.
Theme offers System, Light and Dark with adaptive surfaces and grayscale usage
bars. Background effects and their text contrast guard follow the chosen theme.
Haptics enables app-triggered feedback, including one light response when a
refresh is committed. It defaults on and persists with account preferences.
System-owned feedback, such as iOS Haptic Touch or the system keyboard, remains
controlled by the operating system.
Agent sign-in remains on the host. A quota warning above the Composer appears
at 10% remaining for an unambiguous active account. Once raised, it stays visible
across project/provider changes until dismissed for its original session, even
if a later sample recovers or is unavailable. Usage comes from the host's existing account API through this app's
bundled peer bridge; no upstream Zeron or server changes are required.
Its warning icon and progress fill are orange; the warning has no orange outline.

Notifications currently use a **temporary, mobile-only** implementation: iOS
alerts for a new question, a finished turn, and a quota crossing below 10% are
scheduled from events received by the peer. Quota alerts occur at most once per
session. Preferences are account-local and test mode never posts system alerts.
There is no APNs registration with Zeron's relay. When iOS suspends or terminates
the app it cannot receive live events, so this is not reliable background push.
A future independent notification service is needed for that behavior.

## Notices and verification

[Acknowledgements](docs/ACKNOWLEDGEMENTS.md) describes the bundled inventory.
Settings exposes full notices offline.

See [verification status](docs/STATUS.md) for exact checks and remaining
platform validation. Source implementation is not evidence of a successful
iOS/Android build or device validation.
