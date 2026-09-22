# Status

Honest three-bucket summary as of 2026-09-18 (`f6b39a9` + uncommitted stage
work). Row-level detail with exact statuses:
[PARITY.md](PARITY.md) — **verified 42 · implemented-unverified 25 ·
requires-host-edge-change 6 · blocked 7 · not-started 15**. Evidence:
[evidence/](evidence/).

## Implemented and tested (`verified`)

Exercised against the real edge/engine (`e2e:windows` 13/13 —
[evidence/e2e-report.md](evidence/e2e-report.md)) or fully unit-covered pure
logic:

- **Sync substrate**: registry room, device relay, chat room, presence/dial
  parking, auth restore + PKCE HTTPS callback.
- **Command ledger**: run, steer, interrupt, respondInput,
  cancelOwnCommand; queue enqueue/send-now/steer-now/remove/move.
- **Registry writes**: createSpace, deleteSpace, createChat, renameChat,
  archive/unarchive, markSeen, deleteChat, setChatConfig.
- **Composer logic**: send routing, workspace-write sandbox + autoApprove false,
  picker logic incl. provider-bound sessions, drafts, checkout rules +
  version gate.
- **Transcript projection**, message context menu, a11y labels/roles.
- **Attachments logic**: chunked upload, retry/deadlines, escorts.
- **Workspace-tool logic**: Changes reducer + unified-diff parser, Files
  reducers + conflict handling, History paging reducer, Terminal ANSI model +
  client (replay/resume, 12ms coalesce, 80ms debounce), accounts usage
  thresholds, catalog toggles.
- **Navigation logic**: `layoutFor`, deep-link parsing, redacted logging.
- **Edge patches**: AASA + PKCE + APNs producer (Live Activity + finish
  banners + question alerts) — live-activity unit tests in the patch files;
  full edge `test:unit` still needs the worktree. Deployment required.
- **Relay session mode** (Loro-free, host-authoritative): transcript delta
  reducer ported from `transcript_delta.rs`, `WatchDocMessages`/`WatchQueue`/
  `QueueCommand` over the device relay — e2e 11–13 verify
  run/interrupt/question and doc-mode projection parity.
- **Expo Go iOS export from Windows** — `npm run export:go` produces a 4.5MB
  bundle via `EXPO_GO=1` shim resolution (`.expo-go-export/`).

## Implemented but unverified (`implemented-unverified`)

Needs a Mac build, a device, or a host in the right state:

- All Swift/native modules (`react-native-loro`, `zeron-dictation`,
  `zeron-split-view`) — written, never compiled here.
- Dictation (`SpeechAnalyzer` path is a marked TODO; `SFSpeechRecognizer`
  on-device-only path written).
- Local Voice Model (Whisper Tiny/Base + optional cleanup) — JS pipeline,
  settings, and model manager land; native whisper.rn/llama.rn (or Nitro
  fallbacks) need a Mac spike before artifacts are pinned.
- Composer/attachment UI surfaces, Border Beam, effort-slider haptics,
  shimmer — device rendering.
- Transcript rendering, theme, reduced-motion/transparency runtime,
  Context usage chip — device rendering.
- Terminal on-device rendering/input (font metrics are measured constants).
- Checkout selector UI + `SwitchRef`/`CreateWorktree` round-trip.
- Files/Changes/History RPC round-trips on a live checkout.
- Previews screen exists but is unwired from the session overflow.
- Agent account flows (activate/forget/login) — need provider CLIs.
- Device rename / `UpdateStatus` / `ApplyUpdate`.
- Adaptive shell visuals on iPad; account isolation (by construction);
  archived settings page (shelf exists, per-device page absent).
- Real agent runs — e2e uses the `mock` harness only (the host lists
  codex/cursor as installed; they were not run).
- **Expo Go on-device rendering** — the bundle resolves (`export:go`), but
  no QR scan/device run was possible from this machine; shim fidelity
  (markdown, sheets, menus, glass) is unverified.
- **iOS CI/TestFlight pipeline** — `ios-compile.yml` (unsigned compile
  check, no secrets, **manual dispatch only** — not on merge to `main`)
  and `ios-testflight.yml` (ASC-API-key cloud signing, **manual dispatch
  only** — not on merge to `main`). The IPA is the dispatched SHA
  (`version (run_number)` + short SHA in the binary). Dispatch `main`
  after the work has merged (docs/TESTFLIGHT.md).

## Requires host/edge change (`requires-host-edge-change`)

- AASA + PKCE auth callback — patch `0001-*` in `patches/zeron-edge/` +
  a WorkOS-registered app id.
- Live Activity pushes + push registration routes — same patch + `APNS_*`
  credentials.
- Finish-banner alerts when a run completes — patch `0002-*` + same
  `APNS_*` credentials.
- Question-alert banners when a run asks for input — patch `0003-*` + same
  `APNS_*` credentials. Covers `input`-part questions only (the edge sees
  registry row flips, not chat doc contents). Questions the app detects
  itself (unresolved ask-question tool parts, trailing prose) can't emit a
  dedicated push until the host mints an `input` part for them — prose
  questions still trigger the finish-banner alert when the turn ends.

## Blocked (`blocked`)

- Native split view — never compiled; `USE_NATIVE_SPLIT_VIEW=false` until a
  Mac verifies it.
- Hardware keyboard modifiers — RN 0.86 exposes no modifier flags.
- Shortcuts settings page — same reason.
- Appshots — captures the headed device's frontmost window; nothing to
  expose to the phone.
- Local→synced workspace import — IPC-only (`LocalImportStatus`,
  `ImportLocalWorkspace` are not in `forwardable`, `rpc.rs` L940-1011).
- Engine admin + sync probes (`RelayCommand`, `RetryDelivery`, `ProbeSync`,
  `SyncStatus`, `WatchConnectivity`, `WatchTransfers`, `LocalDevice`,
  `EngineInfo`, `EngineReady`, `StopEngine`, auth admin) — IPC-only.
- Android — out of scope (`platforms: ['ios']`).

## Not started (`not-started`)

Queue edit leases · setChatActivity/setChatHost · review comments ·
session sounds · appearance/theme
library · in-app browser pane · widgets/composer/files settings pages ·
transcript attachment thumbnails · workspace
`zeron-file:` links · new-thread background effects · Watch\*/queue-admin RPC
set superseded by room sync.

## Deviation log (from stage reports)

- `ModelPickerSheet` is a native Modal (`pageSheet` compact, `formSheet` regular); TrueSheet remains for session tools.
- `loro-crdt` npm replaced by a Nitro module over loro-swift 1.13.3.
- Terminal: bespoke ANSI model; LegendList over scrollback+grid.
- `zeron-split-view` not in package.json deps on purpose.
- No device screenshots/recordings — no iOS build was possible on this
  machine; all visual claims are unverified.
