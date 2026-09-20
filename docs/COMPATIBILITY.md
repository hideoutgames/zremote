# Compatibility decisions

This fork of Margelo's `ai-chat-demo` (MargeloChat) is being turned into the
Zeron remote-control client for iPhone and iPad. This file records the exact
versions and the decisions the rest of the work depends on. Update it whenever
one of these facts changes.

## Zeron revision pinned for compatibility

|                                          |                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Repository                               | https://github.com/zeronsh/zeron                                              |
| Commit                                   | `853872d3660047b28e81f80df7744a7f6f3b4beb`                                    |
| Workspace version                        | `0.2.72` (`Cargo.toml` `[workspace.package].version`)                         |
| Commit date                              | 2026-09-17                                                                    |
| Production edge                          | `https://edge.zeron.sh` (`apps/zeron/src/main.rs` `DEFAULT_EDGE_URL`)         |
| WorkOS client id (public)                | `client_01KWD0EAKZKD50YCQJNYSRE4BY` (`DEFAULT_WORKOS_CLIENT_ID`, overridable) |
| Windows engine binary used for local e2e | `https://zeron.sh/releases/zeron-0.2.72-windows-x86_64.exe`                   |

Source locations that define the wire contract this app implements (all
relative to the pinned Zeron checkout):

- Edge routes: `edge/src/index.ts`; auth: `edge/src/auth.ts`, `edge/src/auth-routes.ts`, `edge/src/workos.ts`
- Registry rows (JSON, HLC per field): `edge/src/registry-core.ts`, `edge/src/registry-room.ts`, `docs/registry-sync.md`
- chat2 session rooms (binary frames carrying opaque Loro updates): `edge/src/chat-frames.ts`, `edge/src/chat-room.ts`, `docs/chat2-sync.md`, `crates/sync/src/chat_frames.rs`
- Device-room relay + ControlRpc: `edge/src/device-room.ts`, `crates/rpc/src/device_room.rs`, `crates/rpc/src/lib.rs` (`methods` module = the full RPC surface)
- Session doc schema and command ledger: `crates/doc/src/schema.rs`, `crates/doc/src/commands.rs`, `crates/doc/src/parts.rs`, `edge/src/session-doc/*.ts`
- Proto types: `crates/proto/src/agent.rs` (`RunRequest`, `WorktreeSpec`, `ToolCall`), `crates/proto/src/entities.rs`
- Auth state machine: `crates/engine/src/auth.rs`
- Existing native SwiftUI iOS client (the closest reference for mobile behaviour): `apps/ios/Zeron/**` — in particular `Sync/RegistryClient.swift`, `Sync/ChatRoomClient.swift`, `Sync/ChatFrames.swift`, `Sync/DeviceRelayClient.swift`, `Sync/SessionStore.swift`, `Sync/WorkspaceStore.swift`, `Auth/AuthClient.swift`, `Models/Entities.swift`

The pinned Zeron tree is _not_ vendored. Anything ported from it lives under
`app/src/zeron/**` with a header comment naming the source file. Zeron is MIT
licensed (`LICENSE` in the pinned checkout); the notice is carried in
`THIRD_PARTY_NOTICES.md`.

## React Native / Expo / Xcode / deployment target

| Component             | Version                                        | Why                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React Native          | `0.86.x` (fork ships 0.86.0)                   | Keep the fork's major/minor. Patch bumps to 0.86.3 are allowed (Hermes v1 memory regression fix that matters because the fork imports `react-native-reanimated`/`react-native-worklets`).                                                                                                             |
| React                 | `19.2.3`                                       | Unchanged from the fork.                                                                                                                                                                                                                                                                              |
| Expo SDK              | `57`                                           | The only SDK that targets RN 0.86 (Expo's compatibility table). Installed _into_ the existing bare project (`expo`, `expo-modules-core` autolinking, `expo-dev-client`), not by re-creating the app.                                                                                                  |
| Hermes                | v1 (RN default)                                | Unchanged. No WebAssembly — see "Loro on device".                                                                                                                                                                                                                                                     |
| Xcode                 | `26.x` (Expo 57 requires ≥ 26.4)               | Needed for the iOS 26 SDK (Liquid Glass via `@callstack/liquid-glass`, `SpeechAnalyzer`).                                                                                                                                                                                                             |
| iOS deployment target | `17.0`                                         | Raised from the fork's 16.4: the in-repo `react-native-loro` and `zeron-dictation` pods require iOS 17 (first surfaced by CI `pod install`). Liquid Glass and `SpeechAnalyzer` are gated at runtime to iOS 26+, ActivityKit push-to-start to iOS 17.2+. Older systems get the fork's plain fallbacks. |
| Device family         | iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`) | Already set in the fork.                                                                                                                                                                                                                                                                              |
| Node                  | `>= 22.13`                                     | Expo 57 minimum; the fork required `>= 22.11`. Local machine: Node 24.19, npm 11.17.                                                                                                                                                                                                                  |

Package manager stays **npm** with the committed `package-lock.json`.

## Native project strategy

The fork's committed `ios/` and `android/` projects are nearly stock RN 0.86
templates. Their only deliberate customisations are:

1. `react-native-bootsplash` storyboard + generated assets, initialised from `AppDelegate.swift`.
2. `pod 'SDWebImage', :modular_headers => true` in the `Podfile` (needed by `react-native-nitro-web-image`).
3. `platform :ios, '16.4'` in the `Podfile`.
4. `patch-package` patches under `app/patches/` (bootsplash `HideOnDraw`, keyboard-controller, ios-utilities) — these patch `node_modules`, not the native projects, and are kept as-is. Icons use `expo-symbols` (`UIImageView`), not `react-native-nitro-symbols` (SwiftUI hosting blanks glyphs under the keyboard / Liquid Glass).

`react-native-keyboard-controller` is intentionally pinned to **1.21.12** (JS) over Expo Go's bundled 1.21.9 native: 1.21.9's KeyboardChatScrollView emits `contentOffset {0,0}` on first `animatedProps` evaluation, which feedback-loops the JS thread when a streaming chat opens (fixed upstream in 1.21.12; the fix is pure JS, no `ios/` changes). `expo install --check` flags the version mismatch — that is expected.

The in-thread transcript list is **`@shopify/flash-list` 2.0.2** (Expo SDK 57 pin, FlashList v2, JS-only on New Architecture — no config plugin, no `ios.useFrameworks`). `SessionTranscriptList` uses FlashList with `KeyboardChatScrollView` as `renderScrollComponent`. Home threads and Terminal stay on `@legendapp/list`.

Decision: move to **Expo Continuous Native Generation** with `app.config.ts`
and config plugins. Each customisation above is encoded as a plugin (the
bootsplash Expo plugin, a local `withPodfileMods` plugin for SDWebImage,
`expo-build-properties` for the deployment target). New native requirements —
URL scheme, Associated Domains, microphone/speech/camera/photo permissions,
Live Activities (`expo-widgets` with `enablePushNotifications`), App Groups,
`NSSupportsLiveActivities` — are plugins too. Finish-banner alerts add
`expo-notifications` with `enableBackgroundRemoteNotifications: false` so
`UIBackgroundModes` stays empty. The generated `ios/` and
`android/` directories are then produced by `npx expo prebuild`, and the
committed template projects are removed from git _only after_ the plugin set
has been verified to reproduce every customisation above (`npx expo prebuild
--platform ios --no-install` is runnable on Windows for that check).

We never run a destructive `prebuild --clean` over native changes that are not
encoded in a plugin.

### Branding

The app icon and splash sources live in `app/assets/brand/` (`icon-1024.png`,
`splash-logo.png`), copied from the repo-root `logos/` directory. The splash
logo is a 109px-wide raster, so the bootsplash plugin's `logoWidth` is capped
at 54 (2x = native resolution) until a vector or high-res logo is provided;
`app/assets/bootsplash/*` is regenerated with `npx react-native-bootsplash
generate --platforms ios --background 000000 --logo-width 54
--assets-output assets/bootsplash assets/brand/splash-logo.png`.

## Loro on device

Session transcripts are Loro CRDT documents (`chat2` rooms carry opaque Loro
update bytes; only clients parse them). The official JS package `loro-crdt`
is WebAssembly and **Hermes has no WebAssembly runtime**, so it cannot run in
the app. Decision:

- A small `LoroDocPort` TypeScript interface (`app/src/zeron/doc/loroPort.ts`) covers the ~15 doc operations the client needs: import update, export updates from a version vector, export/import snapshot, oplog version vector + containment test, deep value read, local-update subscription, list `pushContainer(map)`, map set, movable list ops, commit.
- Node (Jest, e2e scripts) uses `loro-crdt@1.13.x` (the engine pins `loro = "1.13"`).
- iOS uses an in-repo Nitro module `react-native-loro` (`app/modules/react-native-loro`) wrapping the official `loro-swift` package, pinned to tag **1.13.3** (revision `625f3e696fca4be3ae77de8b3404fa6753554f21`) — the same binding and version Zeron's own SwiftUI client resolves. The FFI binary (`loroFFI.xcframework`) is fetched by `app/scripts/fetch-loro-ffi.sh` and verified against sha256 `fc55bfb84753a1f0d7ed130d5b03edf3745b6e3db1d62685eeddb77598e09be2` (from `loro-swift/Package.swift` at 1.13.3). The Swift side is written here but **cannot be compiled or verified on Windows**; it is marked implemented-but-unverified until built on a Mac.
- Android is out of scope for the Loro bridge (no Zeron Android client exists; the app targets iPhone/iPad).

Everything schema-related (entries, parts, command ledger, queue rows) is
implemented once in TypeScript against the port, so the Jest suite exercises
the same code that runs on device.

The workspace registry (devices, spaces, chats, session status) is **not**
Loro: it is a JSON row table with per-field hybrid logical clocks
(`registry-core.ts`) and is ported to TypeScript directly.

## Authentication

Zeron uses WorkOS AuthKit. The engine is a public client that builds the
authorize URL itself and delegates the secret-bearing code exchange and refresh
to the edge (`POST /auth/exchange`, `POST /auth/refresh`, `GET/POST
/auth/orgs`). Redirect URIs registered today: the desktop loopback
`http://127.0.0.1:{port}/callback` and the hosted paste-code page
`{edge}/auth/cli/callback`. The mobile flow:

1. **Primary**: `ASWebAuthenticationSession` on `zeron://auth/callback`
   (custom scheme, `preferUniversalLinks: false`) so the WorkOS sheet
   actually presents. WorkOS still uses the registered HTTPS redirect
   `{edge}/auth/cli/callback` plus PKCE. The edge 302-hops iPhone/iPad
   user-agents and `zr1.`-prefixed pending states to that scheme
   (`patches/zeron-edge/0004` + `0005` + `0006`). The 302 completes the
   auth session; the hop HTML also shows `state.code` for in-app paste if
   the sheet is dismissed. HTTPS AuthSession with `preferUniversalLinks: true` is not used:
   without verified AASA/`webcredentials` it silently returns `cancel` and
   never opens `api.workos.com`. `zeron://` Linking is the Safari-fallback
   return path if AuthSession fails to start. If the hop is missing or the
   sheet is cancelled/dismissed, `SignInScreen` shows a paste field so the
   user can paste `state.code` from the Copy-code page;
   `completePastedCode` exchanges it and Keychain `restore()` signs in on
   the next launch. Desktop CLI `zeron login` still sees the paste-code
   page.
2. `state` is minted per attempt with a `zr1.` prefix (so the edge can hop
   without UA sniffing), stored in memory and Keychain until consumed
   (15-minute TTL), and bound to the intercepted code (same CSRF discipline
   as the engine).
3. **PKCE**: `PKCE_ENABLED` is on. `SignInScreen` injects `expo-crypto`
   `randomBytes` / `sha256` into `beginSignIn` (Hermes Web Crypto is not
   the production path). The edge exchange route must forward
   `code_verifier` (`0001`); without that patch HTTPS-callback sign-in fails
   PKCE validation. See `docs/HOST_EDGE_CHANGES.md`.

Tokens (access + refresh) live in Keychain-backed storage (`expo-secure-store`),
namespaced by a sanitized edge URL (SecureStore keys cannot contain `:` or `/`).
WebSocket connections send the bearer as an `Authorization` header
(NitroWebSocket supports headers) instead of `?token=`, so credentials never
appear in URLs or logs.

## Expo Go boundary

The full app is an **Expo development build / custom dev client** — the
Nitro modules, Loro session documents, and Live Activities need it. Expo Go
is a **preview path only**: `npm run start:go` sets `EXPO_GO=1`, which maps
unsupported native modules to JS shims under `app/src/expoGo/shims/` (Metro
`resolveRequest`, bundle-time only — production resolution is untouched),
and sessions run in Loro-free **relay mode** (host-authoritative
`WatchDocMessages`/`WatchQueue`/`QueueCommand`). Details: EXPO_GO.md.

## Capability gates

Host features that must be gated on the reported `DeviceRow.version`
(`deviceVersionAtLeast`). A host below the floor gets an explicit block — never
a silent fallback into a less-safe behavior.

| Capability                                                                                                       | Minimum host version                      | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RunRequest.worktree` (`WorktreeSpec {repoPath, base}` on the first `run` — compose "New worktree" checkout) | **0.2.62**                                | `git log -S"pub worktree: Option<WorktreeSpec>" -- crates/proto/src/agent.rs` → `0a80fc15` (PR #216); `git describe --tags --contains 0a80fc15` → `v0.2.62~2` (first tag carrying it; v0.2.61 predates it). Constant: `MIN_VERSION_RUN_WORKTREE` in `app/src/zeron/protocol/entities.ts`; enforced in `CheckoutSelector` (blocked, "update Zeron on \<host\>"). |
| Shared queue send (`queue` doc rows, composer "Queue" pill)                                                      | capability `message-queue-v1`             | `crates/rpc/src/lib.rs` `QUEUE_MESSAGE`; ComposerView.swift queue-first flow. Without it the live pill degrades to Steer-or-hidden.                                                                                                                                                                                                                                                 |
| Queued attachments (`pending://` refs + escort uploads)                                                          | capability `message-queue-attachments-v1` | `attachments.rs`/`UploadStash.swift`; `sendPlan()` in `app/src/zeron/attachments/sendPlan.ts` falls back to legacy upload-first.                                                                                                                                                                                                                                                    |
| Queue row actions (Send now / Steer now / Remove)                                                                | capability `message-queue-actions-v1`     | `crates/rpc/src/lib.rs` `SEND_QUEUED_MESSAGE_NOW` etc.; `QueuePanel` hides actions without it.                                                                                                                                                                                                                                                                                      |
| Queue row editing (host-authoritative leases)                                                                    | capability `message-queue-edit-lease-v1`  | `Begin/Renew/FinishQueuedMessageEdit` RPCs — **not implemented** (documented gap: rows are read-only in `QueuePanel`).                                                                                                                                                                                                                                                              |
