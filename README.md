# Zeron for iPhone and iPad

A React Native / Expo client for [Zeron](https://github.com/zeronsh/zeron): the
phone is a **peer device in the Zeron mesh**. It renders synchronized
workspace and session state (Loro CRDT documents over the edge's Durable
Object rooms) and drives remote engines through Zeron's durable command
ledger. **No agent, repository operation, or terminal execution ever runs on
the phone** — every action is relayed to the host device that owns the
checkout.

## Origin

This repo started as a fork of Margelo's **MargeloChat** starter
(`ai-chat-demo`). The original blog post:
<https://blog.margelo.com/building-native-llm-chat-app-with-rag>. The
streaming-LLM layer was replaced wholesale by the Zeron protocol stack; the
markdown/transcript/UI toolkit remains and is credited in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[docs/AGENTS_KIT_PROVENANCE.md](docs/AGENTS_KIT_PROVENANCE.md).

## Status

Targets Zeron revision `853872d` (engine v0.2.72). See
[docs/PARITY.md](docs/PARITY.md) for the desktop-parity matrix and
[docs/STATUS.md](docs/STATUS.md) for the honest three-bucket summary —
including what is implemented but unverified because this machine cannot
compile iOS.

## Requirements

- **Node ≥ 22.13**, npm (see `app/package.json` engines)
- **Xcode 26.x** on a Mac for device builds; iOS **17.0+** deployment target
- iOS **26+** on device for Liquid Glass surfaces and the `SpeechAnalyzer`
  dictation path (older iOS falls back to `SFSpeechRecognizer` on-device
  recognition and plain surfaces)
- A Windows machine can run the entire JS verification gate, including the
  **real end-to-end** suite (see below)

## Setup

```sh
cd app && npm ci
```

Environment variables consumed by `app/app.config.ts`:

| Variable                 | Purpose                                                      | Default                 |
| ------------------------ | ------------------------------------------------------------ | ----------------------- |
| `ZERON_EDGE_URL`         | Edge base URL                                                | `https://edge.zeron.sh` |
| `ZERON_WORKOS_CLIENT_ID` | WorkOS client id                                             | the Zeron client id     |
| `ZERON_IOS_BUNDLE_ID`    | iOS bundle id (NOT `sh.zeron.ios` — that is Zeron's own app) | `sh.zeron.mobile`       |
| `ZERON_APPLE_TEAM_ID`    | Apple team for signing/AASA                                  | none                    |

## Native build (Mac)

```sh
cd app
npx expo prebuild --platform ios          # generates ios/
app/modules/react-native-loro/scripts/fetch-loro-ffi.sh   # loro-swift 1.13.3 FFI (checksum-pinned)
cd ios && pod install && cd ..
npx expo run:ios --device                 # dev client + Metro
```

`react-native-loro` and `zeron-dictation` are Nitro modules that autolink via
`file:` dependencies; the Loro FFI `xcframework` is downloaded and
sha256-verified by `fetch-loro-ffi.sh` (pinned tag `1.13.3`, checksum in
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)). `ios.useFrameworks` must stay
unset (Nitro requires static linking).

### Signing, entitlements, callback registration

- **Associated Domains**: `applinks:<edge host>` (set automatically from
  `ZERON_EDGE_URL`) — the edge must serve the AASA route; deploy the edge
  patch in `patches/zeron-edge/` and set `IOS_APP_IDS` (see
  [docs/HOST_EDGE_CHANGES.md](docs/HOST_EDGE_CHANGES.md)). Without it,
  `zeron://` custom-scheme sign-in still works; the https universal-link
  callback does not.
- **APNs**: needed only for Live Activity push updates — the `APNS_TEAM_ID` /
  `APNS_KEY_ID` / `APNS_P8` / `APNS_BUNDLE_ID` / `APNS_ENV` secrets documented
  in `docs/HOST_EDGE_CHANGES.md`. Foreground polling works without them.
- **App Group**: `group.<bundleId>` for the Live Activity extension.

## Windows development loop

Everything JS-side is verifiable on Windows:

```sh
cd app
npm run lint && npm run typecheck && npm test -- --ci
npm run format:check && npm run react-compiler-check
npx expo config --type introspect
node scripts/prebuild-ios-windows.js --clean   # Expo prebuild that works on Windows
npm run e2e:windows                            # real edge (wrangler dev) + real zeron.exe
```

The e2e suite (`scripts/e2e/`) spawns `wrangler dev` and the real engine
against a TypeScript "phone" built from the same `src/zeron` layers the app
uses — 10 steps covering startup, RPC catalog, spaces/chats, run/interrupt,
questions, multi-phone replay convergence, steer, and registry convergence.
Latest evidence: [docs/evidence/](docs/evidence/).

## Expo Go boundary

> The full app is an **Expo development build / custom dev client** — the
> Nitro modules, Loro session documents, and Live Activities need it. Expo
> Go is a **preview path only**: `npm run start:go` sets `EXPO_GO=1`, which
> maps unsupported native modules to JS shims under
> `app/src/expoGo/shims/` (Metro `resolveRequest`, bundle-time only —
> production resolution is untouched), and sessions run in Loro-free
> **relay mode** (host-authoritative
> `WatchDocMessages`/`WatchQueue`/`QueueCommand`). Details:
> [docs/EXPO_GO.md](docs/EXPO_GO.md).
>
> **Demo mode** (Sign in → Advanced → "Try demo mode") runs the whole app
> against an in-process simulated edge + host — sample data, no account, and
> nothing leaves the device. Works in Expo Go and dev builds.

(verbatim from [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md))

## Scripts

| Command                              | What it does                                                          |
| ------------------------------------ | --------------------------------------------------------------------- |
| `npm start`                          | Metro / Expo dev server                                               |
| `npm run ios`                        | expo run:ios (Mac)                                                    |
| `npm run android`                    | expo run:android (out of scope — see STATUS)                          |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit`                                               |
| `npm test` / `npm test -- --ci`      | Jest unit + component tests                                           |
| `npm run format` / `format:check`    | Prettier (pinned 2.8.8 — use the app's local binary, not a global v3) |
| `npm run react-compiler-check`       | react-compiler healthcheck                                            |
| `npm run e2e:windows`                | Real edge + real engine e2e (Windows)                                 |

## Project structure

```
app/
  app.config.ts            Expo CNG config (all native customizations)
  src/app/                 runtime wiring, app shell entry
  src/components/          composer, transcript, agentsKit UI
  src/navigation/          adaptive shell (compact pager ↔ iPad 3-column)
  src/screens/             Home/Session/Settings/Changes/Files/Terminal/
                           History/Previews/AgentAccounts…
  src/demo/                demo mode: in-process simulated edge + fixtures
  src/zeron/
    protocol/              rpc methods, entities, wire types
    doc/                   Loro session docs + registry projection
    transport/             edge http, registry room, device relay, chat room
    auth/                  WorkOS sign-in session
    runtime/               AppRuntime, SessionController, workspace actions
    state/                 zustand stores
    terminal/              ANSI screen model + terminal client
    accounts/ files/ diff/ history/ attachments/   workspace tool clients
    native/                ports: dictation, file bytes, app config
  modules/
    react-native-loro/     Nitro module over loro-swift 1.13.3
    zeron-dictation/       on-device speech (SFSpeechRecognizer/SpeechAnalyzer)
    zeron-split-view/      UISplitViewController Fabric component (unverified)
  scripts/e2e/             the Windows e2e harness
docs/                      architecture, parity, status, host/edge changes
patches/zeron-edge/        edge patches (format-patch + readable copies)
```

## Docs index

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, sync model, navigation
- [docs/PARITY.md](docs/PARITY.md) — desktop-parity matrix
- [docs/STATUS.md](docs/STATUS.md) — what's verified / unverified / blocked
- [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) — capability gates, Loro pin,
  Expo Go boundary
- [docs/HOST_EDGE_CHANGES.md](docs/HOST_EDGE_CHANGES.md) — required edge patches
- [docs/NATIVE_MODULES.md](docs/NATIVE_MODULES.md) — Swift modules + Mac checklist
- [docs/E2E.md](docs/E2E.md) — e2e harness details
- [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md) — iOS CI/TestFlight pipeline
- [docs/evidence/](docs/evidence/) — latest verification outputs
- [docs/AGENTS_KIT_PROVENANCE.md](docs/AGENTS_KIT_PROVENANCE.md) — imported-UI
  provenance

## Licenses

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the MargeloChat and
library notices.
