# AGENTS.md — Zeron for iPhone/iPad

React Native / Expo SDK 57 client for Zeron. The phone is a **peer device**:
it renders CRDT-synced state and issues commands over the host relay. No
agent, git, or terminal execution on the phone.

## Layout

- `app/` — the Expo app (all JS/TS + native modules)
- `app/src/zeron/` — protocol, doc (Loro), transport, auth, runtime, state,
  terminal/, accounts/, files/, diff/, history/, attachments/, native/
- `app/modules/` — Nitro modules: `react-native-loro` (loro-swift 1.13.3),
  `zeron-dictation`, `zeron-split-view` (unverified — see below)
- `docs/` — ARCHITECTURE, PARITY, STATUS, COMPATIBILITY, HOST_EDGE_CHANGES,
  NATIVE_MODULES, E2E, evidence/
- `patches/zeron-edge/` — edge patches (format-patch + full copies)

## Reference clones (sibling of this repo)

`../_ref/zeron` — pinned Zeron source at rev `853872d` (v0.2.72);
`../_ref/zeron-edge-patch` — worktree `zremote-edge-patches` holding the edge
patch commit; `../_ref/zeron-bin/zeron.exe` — engine binary used by the e2e;
`../_ref/loro-swift` — loro-swift checkout (tag `1.13.3`).

## Commands (run inside `app/`)

| Task                    | Command                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install                 | `npm ci`                                                                                                                                             |
| Lint                    | `npm run lint`                                                                                                                                       |
| Typecheck               | `npm run typecheck` (= `tsc --noEmit`)                                                                                                               |
| Tests                   | `npm test` (CI: `npm test -- --ci`)                                                                                                                  |
| Format                  | `npm run format:check` (fix: `npm run format`)                                                                                                       |
| React compiler          | `npm run react-compiler-check`                                                                                                                       |
| Expo config sanity      | `npx expo config --type introspect`                                                                                                                  |
| iOS prebuild on Windows | `node scripts/prebuild-ios-windows.js --clean`                                                                                                       |
| Real e2e (Windows)      | `npm run e2e:windows` — spawns `wrangler dev` + real `zeron.exe`, writes `.e2e/report.md`                                                            |
| Edge tests              | `cd ../_ref/zeron-edge-patch/edge && npm run test:unit`                                                                                              |
| Native build (Mac)      | `npx expo prebuild --platform ios`, then `modules/react-native-loro/scripts/fetch-loro-ffi.sh`, `cd ios && pod install`, `npx expo run:ios --device` |

## Verification gate (run before reporting "done")

`npm run lint` · `npx tsc --noEmit` · `npm test -- --ci` ·
`npm run format:check` · `npm run react-compiler-check` ·
`npx expo config --type introspect` · `prebuild-ios-windows.js --clean` ·
e2e for transport/runtime changes · edge `test:unit` for edge changes.

## Rules

- **Never put tokens in URLs.** Bearer goes in the `Authorization` header
  (`NitroWebSocket` supports headers). `redactUrl` before logging any URL.
- **Never log prompts, message text, or secrets.** `zeron/log.ts` is the
  redacting logger; use it.
- **Never commit** unless explicitly asked; never push to main.
- **Pull requests go only to `hideoutgames/zremote`.** Never open a pull
  request against any other repository, including `margelo/ai-chat-demo` and
  any other upstream. `gh pr create` must use `--repo hideoutgames/zremote`.
  If a pull request is opened against another repo, close it.
- **PRs always target `main`.** Feature branches and worktrees are for
  development only. Do not open or merge a PR into another feature /
  Cursor branch. TestFlight and iOS Compile Check are **manual dispatch
  only** (typically of `main`); stacked PRs never ship. Rebase onto
  `main` and retarget the PR if the work started on a stacked branch.
- **Prettier is pinned at 2.8.8** in `app/` — run `npx prettier` inside
  `app/`, not at the repo root (root has no package.json and resolves v3).
- **`ios.useFrameworks` stays unset** — Nitro requires static linking.
- **`modules/zeron-split-view` stays out of package.json** and
  `USE_NATIVE_SPLIT_VIEW=false` until it compiles on a Mac
  (docs/NATIVE_MODULES.md checklist).
- **Dictation is on-device only** — never fall back to server recognition.
- **Agent account auth is the host's problem** — never reuse the app's
  WorkOS tokens for agent logins.
- **`.git` is never listed** in file browsing (jail boundary — see
  ARCHITECTURE.md).
- Attachments are **≤24MB**, chunked base64 — images plus documents
  (text/pdf/json/…); device-local URIs never leave the phone.
- No AI-generated artwork.
- Standard GitHub runners only.
