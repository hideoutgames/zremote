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

- Sign-in via **paste code** — universal links can't return into Expo Go,
  so the AuthKit URL opens in `openBrowserAsync` and the code is pasted
  back (SignInScreen detects `storeClient` automatically).
- Spaces, sessions, device list — registry layers are unchanged (they never
  needed Loro).
- Live transcript via **relay mode**, send/steer/stop/questions, queue view
  — verified end-to-end by the e2e (steps 11–13) against the real engine.
- Changes, Files, Terminal, History, agent accounts, settings — all
  relay-forwardable RPCs work identically.
- Attachments upload over the relay — expected to work; not yet exercised
  end-to-end in Go.
- Composer keyboard handling, pager, Skia border beam — those modules are
  bundled in Expo Go and resolve unchanged.

## What differs or doesn't

- **Live Activities / APNs** — `expo-widgets` is shimmed; `start` throws
  "not available in Expo Go" (the binding tolerates this).
- **Dictation** — `zeron-dictation` needs Nitro; resolves to
  `dictationUnavailable`.
- **Liquid Glass** — `@callstack/liquid-glass` → `expo-glass-effect`
  `GlassView` (iOS 26 only; otherwise the opaque fallback).
- **Sheets/menus** — TrueSheet → a pageSheet-style `Modal`; Zeego menus →
  `ActionSheetIOS`/`Alert`. Same actions, lower fidelity.
- **Markdown** — `react-native-enriched-markdown` →
  `react-native-markdown-display` (pure JS); `streamingAnimation` ignored.
- **KeyboardAware list** — `@legendapp/list/keyboard` → plain `LegendList`
  - `KeyboardStickyView` shim (RN `Keyboard` events); the chat-tail
    behaviors degrade.
- **Offline queueing / doc persistence** — relay mode keeps no local
  session doc; the host is authoritative (drafts still persist).
- **Universal-link sign-in**, deep links into the app.

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
