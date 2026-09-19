# Expo Go preview

The full app is an **Expo development build** (Nitro modules, Loro CRDT,
Live Activities — see COMPATIBILITY.md). For a quick look on an iPhone/iPad
from **Windows with no Mac and no paid Apple account**, the app also runs in
**Expo Go** as a preview: native modules that aren't bundled in Expo Go
resolve to JS shims at bundle time (`EXPO_GO=1` in `metro.config.js` →
`src/expoGo/shims/`), and sessions run in **relay mode** (no Loro).

## Run it

```
cd app && npm ci && npm run start:go
```

Scan the QR with **Expo Go** on an iPhone/iPad on the same Wi-Fi. If the
phone can't reach the Windows machine's LAN IP, use a tunnel:

```
node scripts/start-go.js --tunnel
```

`npm run export:go` produces a static iOS bundle in `app/.expo-go-export/`
(the "it bundles" proof — verified from Windows, 4.5MB / ~1600 modules).

### Start-menu shortcut (Windows)

`npm run start:go:shortcut` creates **ZRemote Expo Go Server** in Start
(`scripts/install-start-shortcut.ps1`; `-Tunnel` also creates a tunnel
variant). The shortcut launches `scripts/start-go.ps1` in a PowerShell window
titled "ZRemote — Expo Go server" that stays open on errors. In Start, search
"ZRemote", right-click → **Pin to Start** (programmatic pinning is blocked by
Windows).

## What works

- Sign-in via **HTTPS callback** on a development/production build (PKCE +
  AASA). Expo Go cannot receive universal links, so production sign-in is
  not available there — use **Advanced → Try demo mode** to explore the UI.
- Spaces, sessions, device list — registry layers are unchanged (they never
  needed Loro).
- Live transcript via **relay mode**, send/steer/stop/questions, queue view
  — verified end-to-end by the e2e (steps 11–13) against the real engine.
- Changes, Files, Terminal, History, agent accounts, settings — all
  relay-forwardable RPCs work identically.
- Attachments upload over the relay — expected to work; not yet exercised
  end-to-end in Go.
- Composer keyboard handling, pager, Skia border beam — those modules are
  bundled in Expo Go and resolve unchanged. One deliberate exception:
  `react-native-keyboard-controller` is pinned to **1.21.12** (JS side)
  over Expo Go's bundled 1.21.9 native — 1.21.9's KeyboardChatScrollView
  emits a `contentOffset {0,0}` on first `animatedProps` evaluation that
  feedback-loops the JS thread on open (fixed upstream in 1.21.12, and the
  fix is pure JS). `expo install --check` flags the mismatch; that is
  expected.

## What differs or doesn't

- **Live Activities / APNs** — `expo-widgets` is shimmed; `start` throws
  "not available in Expo Go" (the binding tolerates this). Finish-banner
  registration is skipped: Expo Go's device token is the wrong APNs topic.
- **Dictation** — `zeron-dictation` needs Nitro; resolves to
  `dictationUnavailable`.
- **Liquid Glass** — `@callstack/liquid-glass` → `expo-glass-effect`
  `GlassView` (iOS 26 only; otherwise the opaque fallback).
- **Sheets/menus** — TrueSheet → a pageSheet-style `Modal`; Zeego menus →
  `ActionSheetIOS`/`Alert`. Same actions, lower fidelity.
- **Markdown** — `react-native-enriched-markdown` →
  `react-native-markdown-display` (pure JS); `streamingAnimation` ignored.
- **Offline queueing / doc persistence** — relay mode keeps no local
  session doc; the host is authoritative (drafts still persist).
- **Universal-link sign-in**, deep links into the app.

## Demo mode

**Sign in → Advanced → "Try demo mode"** enters a fully in-process demo: a
simulated edge + host (`src/demo/demoEdge.ts`) is plugged into the exact
runtime seams the production path uses — the app's `wsFactory` /
`fetchImpl` / `Clock` / `DocDisk` dependencies — so every screen, store and
controller runs the real code in relay session mode.

What it simulates:

- Registry room: 2 hosts (one live with presence beats, one dark for ~3h),
  3 spaces, 7 chats (working / awaitingInput / idle / errored / archived),
  and client pushes (rename/archive/seen/create) round-tripped as `rows`.
- Device room: the full relay-forwardable RPC surface — transcript streams
  (`WatchDocMessages` reset/delta), the command plane (`run` streams a
  realistic multi-part reply, `steer`, `interrupt`, `respondInput`), the
  message queue, attachments, workspace files, checkout diffs, git history,
  echo terminals, agent accounts, previews, and update status.
- Settings shows "Demo account" / "Exit demo". Demo mode is not persisted
  — a reload returns to sign-in.

**Nothing leaves the device.** `demoEdge.fetchImpl` answers the same
endpoint shapes the runtime calls; there is no network dial, no auth
server, and no account. It also works in the native dev build (the same
`DemoEdge` drives `AppRuntime` with an in-memory DocDisk and forced relay
mode).

## Relay mode vs doc mode

|             | Doc mode (default)                       | Relay mode                                                                         |
| ----------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Transcript  | Loro CRDT doc synced over the chat2 room | `WatchDocMessages` stream of `TranscriptFrame` deltas (first frame = full reset)   |
| Commands    | `commands` list in the doc, synced       | `QueueCommand` RPC → `{commandId}`; a reply means synchronized                     |
| Queue       | doc `queue` list                         | `WatchQueue` snapshots + `QueueMessage`/`MoveQueuedMessage`/… RPCs                 |
| Offline     | full local doc + cursor persisted        | none — host authoritative; reconnect = reset replay                                |
| Selected by | default                                  | `loro()` probe failure (Go, missing pod) or Settings → Sync → "Relay session mode" |

Relay mode is also a production fallback: `AppRuntime.create` probes
`deps.loro()` once and selects relay mode for every session if it throws.
