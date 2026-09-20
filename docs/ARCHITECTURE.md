# Zeron for iPhone and iPad — architecture

The phone is a **peer device** on the Zeron mesh: it joins the same edge rooms
as every other device, renders synchronized state, and drives remote engines
through the durable command ledger. No agent, repository operation, or
terminal runs on the phone. Local speech transcription does.

```
                 ┌──────────────────────── Cloudflare edge ────────────────────────┐
                 │  /auth/*        /registry/{org}/ws     /chat2/{chat}/ws          │
                 │  WorkOS         RegistryRoom (rows)    ChatRoom (Loro rows)      │
                 │                 /device/{id}/ws  DeviceRoom (relay, nudge)       │
                 └──────────┬──────────────┬──────────────────┬────────────────────┘
                            │              │                  │
   iPhone / iPad            │              │                  │        Host machine
   ┌───────────────┐   auth │     registry │            chat2 │        ┌──────────────┐
   │ UI (RN)       │ ◄──────┼──────────────┼──────────────────┼──────► │ zeron engine │
   │ state (zustand│        │              │                  │        │ agents, git, │
   │ doc mirror)   │ ────── ControlRpc over device-room relay ───────► │ terminals    │
   └───────────────┘                                                   └──────────────┘
```

## Layers (`app/src`)

| Layer                          | Path                                               | Rules                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol codecs and wire types | `zeron/protocol/`                                  | Pure functions and types ported from the pinned Zeron sources (`chatFrames.ts`, `registryCore.ts`, `deviceFrames.ts`, `rpc.ts`, `types.ts`, `commands.ts`, `messages.ts`). No I/O, no React. Every file names its Zeron source.                                                                                                                                             |
| Doc port                       | `zeron/doc/`                                       | `LoroDocPort` interface + `loro-crdt` adapter (Node) + native adapter (iOS). `sessionDoc.ts` projects a doc into entries/commands/queue and performs the phone's only writes (append command entries, queue rows). `registryDoc.ts` is the client-side row table with a pending-op overlay.                                                                                 |
| Transports                     | `zeron/transport/`                                 | `edgeHttp.ts` (fetch + bearer + single-flight refresh), `registryClient.ts`, `chatRoomClient.ts`, `deviceRelayClient.ts`, `ws.ts` (WebSocket factory: NitroWebSocket on device, `ws` in Node). Reconnect/backoff/liveness discipline mirrors `crates/sync` and the Swift client.                                                                                            |
| Auth                           | `zeron/auth/`                                      | AuthKit authorize URL, state binding, optional PKCE helpers, exchange/refresh/orgs, `SecureStorePort`, the `SignedOut → NeedsOrganization → SignedIn` state machine. The live app matches the engine: no `code_challenge`.                                                                                                                                                  |
| Synchronized domain state      | `zeron/state/`                                     | zustand stores fed only by the layers above: `authStore`, `workspaceStore` (devices/spaces/chats/sessions + derived indicator/sort), `sessionStores` (one per open chat: entries, commands, run status, pending optimistic sends), `catalogStore` (per-device `ListHarnesses`/`ListModels`), `draftStore` (per-session drafts + staged attachments, persisted per account). |
| Native services                | `zeron/native/` and `app/modules/*`                | `react-native-loro` (Nitro over loro-swift), `zeron-dictation` (SpeechAnalyzer / on-device SFSpeechRecognizer), Live Activities (`expo-widgets`), secure storage, haptics. Each has a JS port interface so Jest runs without them.                                                                                                                                          |
| Presentation                   | `screens/`, `components/`, `components/agentsKit/` | Views receive typed domain state and callbacks; they never touch frames, sockets, or Loro. `components/agentsKit/` is the native adaptation of Agents Kit components (see `docs/AGENTS_KIT_PROVENANCE.md`).                                                                                                                                                                 |

## Identity and scoping

- **Account** = WorkOS user (`sub`) inside an **organization** (`org_id` claim). All caches, drafts, doc snapshots, registry snapshots, and push registrations are keyed by `{orgId}/{userId}`; sign-out closes rooms, removes Live Activity registrations, and isolates (does not merge) the cache.
- **Device** = a UUID minted once per install and stored in secure storage. It stamps registry ops (HLC suffix), command `issuedBy`, and the `device` field on chat2/registry hellos. The phone never writes an engine `devices` row.
- **Space** = (deviceId, folder) row. **Chat/session** = registry `chats` row (+ `sessions` status row) and its chat2 Loro doc. **Checkout** = `cwd`/`branch`/`checkoutId` on the chat row.
- **Run / turn / message** ids come from the doc; the phone mints message ids for optimistic echo (`run.messageId`), command ids, and upload ids.

## Command plane

`run`, `steer`, `interrupt`, `respondInput` are append-only entries in the
session doc's `commands` list (schema in `crates/doc/src/commands.rs`). The
phone writes `{id, kind, payload, issuedBy, issuedAt, basedOn?, expiresAt,
status:"pending"}`, commits, pushes the Loro update as a chat2 row, and POSTs a
durable nudge to the host's device room. Only the host writes outcomes
(`applied|rejected|expired|superseded`); the phone may set `cancelled` on its
own still-pending entries. UI status derives from: local commit → chat2 ack
(synchronized) → command status from the host → session status row
(`working|awaitingInput|errored|idle`, staleness-gated at 45 s) → message
`streaming|complete|aborted`. A queued interrupt is shown as "Stopping…" until
the host marks it applied and the session row leaves `working`.

Optimistic user entries share the command's `messageId`; when the host writes
the real entry with that id the pending echo is dropped, never duplicated.

## Attachments

Bytes never ride the doc. Images and documents are staged on the **host device**
over the relay (`UploadChunk` → `UploadCommit` → durable path) or, on hosts that
advertise `message-queue-attachments-v1`, referenced as `pending://{uploadId}/{name}`
while the bytes chase the command. The run request carries both the
`attachments` paths and the `Attached files (local files …)` prompt trailer,
matching desktop. Device-local URIs are never sent to a host. Composer Attach
→ Files presents the system document picker with `multiple: true` after the
menu has dismissed; every returned asset is batch-staged into the draft
(24MB cap per file, oversized siblings rejected without dropping the rest).
iOS `expo-document-picker` is patched so multi-select copies each
security-scoped URL (`asCopy: false` when `multiple`).

## Background continuity

The app never keeps a background socket alive. Hosts execute independently;
when the app returns to the foreground each open room re-hellos with its
persisted cursor and reconciles (rows since cursor, checkpoint if the frontier
is not contained). Live Activities are updated by APNs pushes produced host/edge
side (see `docs/HOST_EDGE_CHANGES.md`); the app only registers per-activity
push tokens and deep-links back to the exact session. Finish banners are
separate APNs **alert** pushes on a native device token (`kind: "alert"`):
the app registers the token, suppresses the banner when that thread is
already on screen, and opens `zeron://session/{chatId}` on tap. The same
alert tokens fire when a run flips `working` → `awaitingInput` (body
"The agent needs your input", no prompt text) so lock-screen question
alerts work without a background socket. While the app is active the JS
layer presents that flip locally via `shouldPresentBanner` (covers
"I'm on another thread").

## Navigation and adaptive layout

`src/navigation/AdaptiveShell.tsx` is the app's root container (replaces the
bare pager in `ZeronApp`). `layoutFor(width, prefs)` (pure, unit-tested) maps
window width to a plan:

- **< 700pt** → `compact`: the original `RootPager` (Home ↔ Session).
- **≥ 700pt** → `regular`: Sidebar (`HomeScreen` at 340–420pt) + Detail
  (`SessionScreen`). The threads column fills the window height and
  **pushes** the session (full-width when collapsed); search, folder, and
  settings use the same Liquid Glass chrome as iPhone. The iPad right
  inspector column is gone — History / Files / Terminal open from the
  session overflow menu as 75% `TrueSheet`s (`SessionSheet`, same chrome as
  View details / Sub-agents: grabber, no close button, first detent 0.75).
  Changes and Previews are not in the menu; checkout diffs live in the PR
  modal. Transcript is capped at ~720pt (or the detail width minus 48pt);
  the composer stack is capped at 560pt inside the same detail gutters. Both
  columns are centered in the detail pane.

Selection (`chatId`), sidebar collapse, and drafts persist
across size-class changes because they live in the shell or the stores, not
in the column tree. `SessionScreen` stays mounted while columns toggle; the
compact pager's `Freeze` only applies when the session page is not visible.

On iPhone and iPad the session overflow menu opens View details, Sub-agents,
History, Files, and Terminal as `SessionSheet`s.

Compact `RootPager` has `scrollEnabled={false}` — opening a session is tap
only. Back to threads is a leading-edge pan (~24pt, iOS interactive-pop
width) on the session page; a mid-screen swipe does not page Home. Regular
width has no pager (sidebar + detail).

**Hardware keyboard gaps:** RN 0.86's `TextInput.onKeyPress` reports `key`
but exposes no modifier flags on iOS, so Cmd+Enter cannot be distinguished
from Enter in JS — documented gap; Escape-to-dismiss sheets is likewise not
reachable from JS and is deferred to the native split-view stage. Sheet
dismissal: TrueSheet `dismissible` (default true) closes on grabber swipe or
a tap on the dimmed area (session tools: `SessionSheet` / `GlassSheet`);
RN `pageSheet`/`formSheet` Modals set `allowSwipeDismissal` plus
`onRequestClose` so dim-tap and swipe-down update `visible`. Overlay popups
(`EffortOverlay` on the composer, `ImagePreviewModal`) use a full-screen
Pressable backdrop. Inside `ModelPickerSheet` the effort overlay is
`embedded` (absolute fill, no second Modal) so it is not stacked behind
the pageSheet / formSheet. The Expo Go TrueSheet shim honors `dismissible`
the same way.

**Popover anchoring:** `@lodev09/react-native-true-sheet` has no iPad popover
anchoring — its `anchor`/`anchorOffset` props only center/align the sheet on
web. `ModelPickerSheet` is an RN Modal on both size classes: compact
`pageSheet` (same host as Settings / the PR sheet), regular `formSheet`.
Checkout selection already uses a Zeego dropdown (popover-anchored natively).
TrueSheet remains for session tools (`SessionSheet` / `GlassSheet`).

A started session is bound to `chat.config.harness`. The composer recent
menu and More sheet list that provider's models only.

**Compose** (`Composer` `mode: 'compose'`, draft key `__compose__`): both
iPhone and iPad Home show a right-aligned circular liquid-glass **New thread**
button (`square.and.pencil`). Compact width (`RootPager`) mounts
`SessionScreen` without a `chatId` after tapping New thread. Regular width
(sidebar + detail) launches into that blank compose session (composer
focused); a `requestedChat` deep link or notification still opens the
thread instead.
The host / repo / origin dropdowns sit between the grabber and the
input (`lockHarness={false}` on the model picker). Send creates the chat
(`createChat` / `createProjectlessChat`), moves the compose draft onto
the new id, then `sendRun`. Last host/space/model persist in
`uiPrefs.composeDefaults`. Existing sessions leave host/cwd/branch on
the thread Details sheet.

## Auth callback

`ZeronApp` waits for `AuthSession.restore()` (SecureStore) before showing
`SignInScreen`, so a returning user never flashes signed-out. Authorize +
exchange match the Zeron engine (`PKCE_ENABLED` is off): no `code_challenge`,
and `POST /auth/exchange` is `{ code }` only. The edge holds the WorkOS
client secret. WorkOS still redirects to the registered HTTPS URI
`https://{edge}/auth/cli/callback`. The app starts
`ASWebAuthenticationSession` on `zeron://auth/callback` (custom scheme,
`preferUniversalLinks: false`) so the WorkOS sheet actually presents —
HTTPS AuthSession with universal links silently cancels without verified
AASA/`webcredentials` and never opens `api.workos.com`. The edge 302-hops
iPhone/iPad user-agents and `zr1.`-prefixed pending states to that scheme
(`patches/zeron-edge/0004` + `0005` + `0006`). The 302 still completes
`ASWebAuthenticationSession`; the hop HTML also shows `state.code` so the
in-app paste field works if the sheet is dismissed.

Pending sign-in state is persisted in Keychain (15-minute TTL) so a Safari
hop or process death can still `completeSignIn`. Tokens are stored under a
sanitized SecureStore key (URL `:`/`/` are illegal in Keychain keys).
`zeron://` Linking is the Safari-fallback return path if AuthSession fails
to start. Concurrent Linking + Sign-in `completeSignIn` calls join one
in-flight exchange. If AuthSession does not return a callback (cancel,
dismiss, missing hop), `SignInScreen` shows a paste field: the user copies
`state.code` from the edge hop/Copy-code page (or pastes the callback URL)
and `completePastedCode` runs the same exchange.
Successful exchange persists tokens in Keychain; `restore()` on next
launch signs the user in automatically. Desktop CLI `zeron login` still
sees the paste-code page. AASA (`IOS_APP_IDS`) remains useful for HTTPS
universal links into the app but is not required for the custom-scheme
AuthSession.

## Workspace tools (Files / Terminal / History)

These are thin screens over host-relayed RPCs — nothing runs on the phone.

- **Changes** (`screens/ChangesScreen.tsx`, `components/agentsKit/FileDiff.tsx`,
  `zeron/diff/`): `WatchCheckoutDiffs` stream (Vec<CheckoutDiff>) filtered to
  the chat's `checkoutId` (falling back to `cwd` match), plus one-shot
  `GetCheckoutDiff` / `GetCheckoutFileDiffText` for expansion. States mirror
  the desktop pane: preparing / clean / error / summary rows. Wire shapes:
  `crates/proto/src/entities.rs` L657-746 (`CheckoutDiff`,
  `DiffFileSummary`, `CheckoutFileDiffText`), dispatch
  `crates/engine/src/rpc.rs` ~L1639-1730. No commit/stage RPCs exist, so the
  screen offers none (copy path / copy patch only, via `expo-clipboard`).
- **Files** (`screens/FilesScreen.tsx`, `screens/FileEditorScreen.tsx`,
  `zeron/files/filesClient.ts`): `ListWorkspaceDirectory` (+ `includeIgnored`
  toggle; `.git` is never listed — filtered host-side and client-side),
  debounced `SearchWorkspaceFiles`, `ReadWorkspaceFile` → monospace editor,
  `ReadWorkspaceImage` chunked base64 → `NitroImage`, `WriteWorkspaceFile`
  with `expectedCheckoutId` + `expectedContentHash` (conflict → "File
  changed on host — reload or overwrite?"), `WatchWorkspaceFiles` refreshes
  the listing and honors `resyncRequired`. Shapes:
  `crates/proto/src/entities.rs` L384-640; dispatch `rpc.rs` ~L2089-2144.
  Path-jail errors surface verbatim.
- **Terminal** (`screens/TerminalScreen.tsx`, `zeron/terminal/ansi.ts`,
  `zeron/terminal/client.ts`): `OpenTerminal {chatId, cols, rows}` opens a PTY
  in the chat's checkout cwd on the host (rpc.rs L294-332); the phone only
  renders and sends input bytes. `SubscribeTerminal {terminalId, afterSeq?}`
  replays a bounded 1MB window from `afterSeq` then tails (terminals.rs
  L296-322) — reconnects resume from the last seen seq and never open a new
  shell; exiting the screen cancels the subscription but leaves the PTY
  running (exited shells retain replay state under a 30-min TTL,
  terminals.rs L37). `WriteTerminal` sends base64 input coalesced 12ms like
  desktop (view.rs L33); `ResizeTerminal` debounces 80ms on layout;
  `CloseTerminal` runs only from the confirmed "Close shell" action. The
  renderer is a justified specialist renderer: a pure screen model
  (`AnsiScreen`, fully unit-tested) implements a fixed cols×rows grid, cursor
  movement (CUP/CUU/CUD/CUF/CUB/CHA/VPA), ED/EL erase, SGR (bold/dim/italic/
  underline/inverse, 16/256/truecolor fg/bg), 5k-line scrollback, CR/LF/BS/
  TAB, wrap, `?25l/h` cursor visibility, OSC 0/2 title, and safely ignores
  other CSI/OSC/DCS. Rows render as monospace Text runs with a cursor block.
  Input is a hidden TextInput plus a key bar (Esc, Ctrl, arrows, Tab, Ctrl-C)
  mapping to byte sequences. Tabs allow multiple shells per session; exited
  shells stay listed (dimmed, with `[exit N]`) until the host TTL expires.
- **History** (`screens/HistoryScreen.tsx`, `components/threadPrs.ts`):
  change requests for this thread from `WatchCheckoutChangeRequest` only
  (no provider URL scraping). Tapping a row opens `PrSheet` filled from
  Zeron data (Open/Draft/Merged badge, checkout `+/-` and file count,
  Overview / Discussion / Commits). Overview is the change-request body
  plus checkout diffs (`ChangesScreen`); Discussion and Commits show
  `ListGitHistory` for the session cwd. Share and “Open in browser” use
  the host-provided URL (no in-app merge or CI — the host has no
  checks/merge RPCs).
- **Previews** (`screens/PreviewsScreen.tsx`): still implemented
  (`WatchPreviews {chatId}`) but unwired from the session overflow.
- **Agent accounts** (`screens/AgentAccountsScreen.tsx`,
  `zeron/accounts/accounts.ts`, under Settings → device): per-device
  `ListAgentAccounts` provider cards (active, plan label, usage meters at
  desktop thresholds — amber ≥80%, red ≥95%, compact reset time),
  `ActivateAgentAccount`, confirm-gated `ForgetAgentAccount`, and the add
  flow (`StartAgentLogin` → paste-code `CompleteAgentLogin`, or browser-poll
  `PollAgentLogin` until done + `CancelAgentLogin`). All calls run on the
  chosen host device; app WorkOS auth is never reused.
- **Device settings** (`screens/SettingsScreen.tsx` device page): rename via
  `Mutate {op:'renameDevice'}` (rpc.rs L895), `UpdateStatus` stream +
  confirm-gated `ApplyUpdate` (rpc.rs L1625-1633), and per-device
  `GetTitleSettings`/`SetTitleSettings` (registry.rs L110).
- **Clipboard/share**: `expo-clipboard` everywhere copy existed before
  (session id, diff paths/patches, commit sha, preview URLs); assistant
  messages share via `Share.share`; transcript rows have a context menu
  (copy text, share, `zeron://session/{id}` link).
