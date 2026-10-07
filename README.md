# ZRemote

A focused native Zeron peer for iPhone, iPad, and Android, built with Swift,
SwiftUI, Skip Fuse, and Zeron's Rust mobile core. Agents and project operations
execute on your remote computer. The mobile app never runs an agent or shell.

The Composer is the main view. Phones slide it aside to reveal Sessions;
tablets use a side panel while the window is at least 700 points wide. Narrow
tablet windows switch to the phone drawer and presentation style. Model
selection, project creation, PR information,
and changed-file details open in phone bottom sheets or centered tablet modals.
Tablet modals slide up from below the window and slide down on dismissal;
Reduce Motion uses a brief fade.
Settings is a full-page phone modal. On iOS, its Settings title stays inline with
Done. Its profile card uses the available
account photo, name and email. Native account, filtering and
session menus
keep the sidebar compact. Model modes and effort controls remain in the picker.

The phone drawer moves the entire Composer/chat page, including its safe-area
backgrounds, over a full-window Sessions layer. It reveals 90% of the screen
with large continuous corners and a spring settle, leaving a 10% strip of the
main page visible for tap dismissal. Swipe right from the broad
leading edge to open, or left across Sessions/the exposed page to close
(directions mirror in right-to-left layouts). Short flicks and predominantly
vertical drags do not toggle it; scrolling, refresh and text-selection gestures
keep their own interaction. Held horizontal swipes track the finger directly,
then spring into place on release. Passive transcript drag tracking can coexist
with the drawer; the native vertical scroll still waits for its direction decision.
The page surface and its Composer/chat content move as one, including newly
selected chats and the blank Composer. Content replacement has no separate
layout or insertion animation during drawer movement. Sessions controls
pause briefly on opening so the hamburger touch cannot
reach them. Opening Sessions clears Composer focus; closing it keeps the keyboard
dismissed until the editor is tapped again. Sessions search accepts focus only
while expanded in the open drawer. The Sessions header places the profile
button on the leading side and Search on the trailing side; Search expands
across the header.
The inactive main phone page has a 2.5% black tint that fades with the drawer's
swipe and settling animation; the open page returns to its normal appearance.
Tablets retain their Sessions side panel.

The picker follows Zeron's compact provider tabs, favorites and scoped search,
using original provider marks in the picker and Composer. The Composer includes
the effective reasoning level and Fast mode. Test mode includes Claude Code,
Codex and the configurable Devin Fusion fixture.
On iOS, model configuration popovers stay anchored to their model row and can
move above, below or beside it to fit the screen. Hosted content respects the
native popover safe area, including its arrow. The title and Close remain fixed;
only the options scroll when the keyboard or available height constrains the panel.
Picker animations preserve the layout and respect Reduce Motion. Each model,
including favorites, remembers its own effort and options; new sessions restore
the last used provider. On iOS, microphone input defaults to on-device Dictation.
Settings offers optional Parakeet downloads under Audio Model, with minimal
language rows and native long-press management. See
[model and audio preferences](docs/MODEL_AND_AUDIO_PREFERENCES.md).

Session rows show state (orange awaiting a response, blue finished/unread,
gray read/idle, red error), a smaller working animation, and the latest observed
PR's state badge. The state indicator and provider icon share the title line's
vertical center. Compact View hides only the activity/completion-age line.
On iOS, working indicators use Zeron's native animated dots: the 2×3 violet
grid in Sessions and the chat header, and the 3×3 pastel grid in the transcript
and refresh recess. The 750 ms Core Animation cycle becomes static with Reduce
Motion enabled. Source and license details are in [Provider marks](docs/PROVIDER_MARKS.md).
Sessions defaults to Group: None, with no list title or visible scroll indicator.
The Show menu can restrict the list to one project without category headers;
in Show all, project and status headers expand and collapse their sessions, with
the animated chevron immediately after the category name, separated by an 8-point gap.
Project and Host groups follow their most recently updated visible session,
independent of pinned rows and the chosen within-group sort. Status groups use
Needs attention and Finished. Opening an unread session clears its blue dot
immediately, holds it in Needs attention for one second, then fades it into
Finished. New work, questions and errors take precedence over that hold.
Filters, sorting, grouping, collapsed categories and Compact View persist per
account; search text stays transient. Sidebar PR
badges contain the state-colored icon and number. Native iOS PR menus retain
those icon colors, and the account menu uses the same control size as its peers.
On iOS 26, the project-list button uses a native Liquid Glass button. Account
initials/photos and PR symbols are native button content so they follow the
button as it opens its menu. The account control leaves its native glass shadow
unclipped, including while search expands. Its Accounts submenu lists saved
Zeron accounts, marks the active account and keeps Add account and Sign out in
a separate Manage section. Switching accounts preserves isolated local data and
secure credentials for every saved account.
Near the bottom of Settings, Archived opens a pushed page with a search bar
above all synced archived chats, ordered by recent activity. Search matches chat
titles independently of the Sessions drawer filters. Selecting a chat opens it
without changing its archive status.
The display-options button keeps its neutral slider icon when filters are active.
On iPhone and iPad, its native menu retains the open submenu during session
activity updates; only changes to menu choices or selections rebuild it.
Project folders and switches also use adaptive grayscale colors. Merged PRs use
the [official Zeron iOS purple palette](https://github.com/zeronsh/zeron/blob/main/apps/ios/Zeron/Design/Palette.swift)
(`#5B43E8` light / `#8B7CF6` dark).
Session rows use their provider's icon, including in test mode. Search expands
as one continuous control before focusing its editor. Between the provider and
title, Zeron's translucent project tile shows the project's initial and stable
path-based color. It is hidden when grouped by Project or when a specific project
is selected in Show. Sessions without a project use Zeron's Home tile. Expanded
activity text stays aligned with the title as the tile appears or disappears.

Pull down at the top of Sessions to refresh, including short or empty lists.
On phones and tablets, the recessed strip tracks native scrolling directly
without an additional SwiftUI animation.
The gesture reveals a recessed strip with inset edge shadows. Its dots stay
still and grow with the pull. A qualifying release commits the refresh, settles
the glyph with a small spring, then starts its animation and one quiet sound/haptic.
Reduce Motion keeps the glyph still and skips the spring.
A selected Composer image keeps its filter, full-window
scale and position, with a darker overlay; otherwise the strip uses a slightly
darker page background. Refresh asks the existing peer to resync, and further
remote updates can arrive after the gesture finishes. The indicator stays visible
for at least half a second even when the local resync request returns immediately.

The composer supports native file/photo/camera attachments and host-backed
`/commands`, `$skills` and `@files` suggestions. References are highlighted in
the editor and sent messages as short, color-coded labels; caret movement,
backspace and selection treat each selected reference as one unit. Drafts and
sends retain the original host reference. Suggestions filter against the current
caret query, with 32-point single-line rows in a floating panel above the Composer.
The panel fits its content and scrolls only beyond its existing maximum height
of 168 points, capped to 30% of the keyboard-adjusted viewport. Empty and loading
messages also fit their content. On iOS 26 it uses native Liquid Glass, with a
material fallback on earlier iOS versions. Commands and skills
show `name ≈ description` with their `/` or `$` prefix and no icons; files show
a small type icon and `filename ≈ TYPE file`. Long rows truncate with an ellipsis.
Failed host suggestion requests expose Retry instead of claiming no matches.
Existing chats supply only their chat target; new composers supply only their
selected project target, as required by the host workspace API.
User messages align right. Agent text and code use
native iOS range selection handles (Compose selection on Android); fenced code
blocks also have a Copy action. PR and sub-agent cards use only Zeron's metadata.
On iOS 26 and later, the chat header uses a native Liquid Glass surface behind
the Sessions button, title, PR menu, and session actions while the transcript
scrolls underneath. Earlier iOS versions and other platforms retain the top blur.
Tapping noninteractive areas dismisses the iOS keyboard and clears editor focus.
Buttons, links, and native text selection retain their own gestures.
Jump to latest stays visible while the transcript is away from the bottom and
hides only after reaching it. The iOS transcript uses reusable native collection
cells with stable message/block identities, asynchronous cached Markdown preparation,
and visible-row sizing, adapting Zeron iOS's viewport reuse and reading-anchor
approach to ZRemote's existing cards. The collection starts at the tail without
laying out every historical message. Composer and keyboard insets are included;
user scrolling pauses following through deceleration. Updates preserve the visible
row while reading history. Jump targets the tail and resumes following. Switching
sessions cancels preparation and resets the position. Try mode's longer planning
conversation contains 500 review passes for exercising this path.
Sub-agent cards show only a title and state; Working uses a quiet shimmer that
stops with Reduce Motion. User-message context menus include the recorded send
time, and completed turns show their recorded work duration in subheadline text,
10 points beneath their reply or changed files when timing is available.
Empty streaming parts and outer prose line breaks do not reserve transcript
space; fenced code retains its original bytes. No receive-time estimate replaces missing data.

The blank Composer shows a compact provider icon with a subtle tint, lighter
than the background in dark mode and darker in light mode, and offers both
project and checkout selection in a single leading-aligned row above the editor.
Its header retains the Sessions button without
a session title or subtitle.
Tablet editor height adapts to the visible viewport, reserving space for the
complete Composer card and its attachment, model, and send controls above the
keyboard. Longer drafts scroll inside the editor in short windows or landscape.
iOS measures text independently of its scrolling mode and decorates only changed
content, so typing across the height cap does not repeatedly resize or reset selection.
The last host, project and checkout are restored per account. Existing checkouts
are revalidated with the host before sending; a missing checkout requires a new
choice. New Session retains the last destination.
Choose the current
checkout, another existing checkout, or
New worktree. Worktree creation travels with the first message to the host;
selecting it alone creates nothing. Session actions → Details shows the thread
title (editable), project, checkout, model, host, and creation/update times.
The pencil button sits at the top left, in the same row as Details and Done,
and opens the title editor.

Agent questions temporarily replace the Composer with a matching answer card.
Each question has full-width choices, an optional multiline custom answer, and
Back/Next navigation that preserves answers. Selecting the custom answer keeps
the full editor and its bottom spacing visible as the keyboard opens or the
answer grows. The final Send answer action stays
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
The playground includes sixteen chats across five projects and three hosts:
Codex, Claude Code and Fusion, pinned/unread/failed states, archived chats,
multi-question answers, long Markdown/code transcripts, a previewable text
attachment, seven-file diffs, and open/draft/merged/closed PR samples without
external links. The offline host offers a cached sample transcript.
**Live agent playground** stays working, cycles bounded simulated progress and
subagent details, and starts with three editable/reorderable queued messages
(including an attachment). Queue and steering use the normal demo interfaces;
Stop pauses the sample and leaves queued messages intact. Leaving Try cancels
its tasks, and entering Try again restores the samples. Backgrounding suspends
the showcase timer. Real sign-in, account credentials and notification delivery
still require the live client.

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
folder to enable Create project; a registered project uses a neutral folder/cog
icon and Choose project, which selects it without creating a duplicate.

Turn diff snapshots are best-effort and can expire on the host. The client
captures available patches when a turn completes and retains immutable,
account-scoped revisions. Concurrent checkout edits may also appear in the
host's turn diff; it is not an audit log of agent-only filesystem activity.
Individual file review keeps the path above a top-aligned, vertically scrolling
diff. Long code lines wrap within the page alongside their original line numbers
and addition/deletion markers.
Unavailable data is never substituted with a later checkout diff. Zeron exposes
the current PR for a branch, so the client retains distinct PRs as it observes
them in each session. These are first-observed positions, not historical creation
events. PR review opens the supplied HTTPS link. A missing profile photo uses
initials; the client does not look up an avatar from another service.

The optional background decorates a blank new Composer and the transient
Sessions refresh recess. It stays hidden on other surfaces. The blank tablet
Composer retains its image and accepts input beside the expanded Sessions panel;
opening a secondary modal hides the Composer image.
There is no terminal, general file browser, repository administration, or direct
GitHub integration.
Settings → Use Background Image exposes an Effect picker with Zeron's None,
Dither, ASCII, Halftone and Scanlines treatments and native contrast guard. Images
are downsampled before account-local storage and never uploaded to the host. By
default the image fades out just above the blank Composer's provider icon; Full
height background restores the extended treatment and is off by default.

Settings lists connected devices and host-reported agent accounts/plan usage.
Theme offers System, Light and Dark with adaptive surfaces and grayscale usage
bars. Background effects and their text contrast guard follow the chosen theme.
Haptics enables light responses for navigation, list options, accepted sends,
voice start/finish, committed refreshes and newly observed agent completion.
Sounds adds distinct quiet dot cues for sends, voice start/finish, refresh and
completion. Both switches default on and persist with account preferences.
Foreground interaction cues do not replay old completions or duplicate a refresh
already in progress. Sounds are original bundled PCM assets generated by
`scripts/generate-feedback-sounds.py`, without downloaded samples.
All switches share the native switch style and an adaptive grayscale tint.
On iOS, refresh stays active for at least 900 ms after release, including held
pulls, so the native
loading inset settles briefly before collapsing; the recess has a subtle tint
and soft top/bottom shadows. The model picker uses equal top and bottom padding,
including above the home indicator.

System-owned feedback, such as iOS Haptic Touch or the system keyboard, remains
controlled by the operating system.
Agent sign-in remains on the host. A quota warning above the Composer appears
at 10% remaining for an unambiguous active account. Once raised, it stays visible
across project/provider changes until dismissed for its original session, even
if a later sample recovers or is unavailable. Usage comes from the host's existing account API through this app's
bundled peer bridge; no upstream Zeron or server changes are required.
The warning uses a compact neutral card with a subtle border, a remaining
percentage, a thin amber meter, and a 44-point icon-only dismiss control.
Settings usage meters use adaptive gray fills and quiet tracks. Agent providers
lists host-connected accounts; connecting an agent remains a host operation.

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
