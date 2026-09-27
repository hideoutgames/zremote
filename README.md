# ZRemote

ZRemote is the iPhone and iPad build of [Zeron](https://github.com/zeronsh/zeron), shipped under the existing ZRemote App Store identity.

## Attribution

The iOS app (`apps/ios`) and the Rust mobile core it links are from the [Zeron](https://zeron.sh) project by Wing — [zeronsh/zeron](https://github.com/zeronsh/zeron). This repository vendors that code at [`433aa148`](https://github.com/zeronsh/zeron/commit/433aa148d55e3316dab9d69afc402e0bb8f55583). Zeron is [MIT licensed](LICENSE); copyright (c) 2026 Wing. Other bundled components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

ZRemote changes the App Store identity only: bundle id `no.hideout.zremote`, the ZRemote display name, and the logos in [`logos/`](logos/).

- **Bundle id:** `no.hideout.zremote` (override in CI with the `IOS_BUNDLE_ID` variable)
- **Display name:** ZRemote
- **Icon and sign-in mark:** [`logos/`](logos/) (`AppIcon.png`, black/white `ZRemoteLogo`)
- **TestFlight:** [iOS TestFlight](.github/workflows/ios-testflight.yml) — see [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md)

No agent runs on the phone. Rust decides what to paint; Swift paints, scrolls,
and handles gestures. The crates in this repo are only the ones `zeron-mobile`
links (`mobile`, `client`, `doc`, `proto`, `markdown`, `text`, `syntax`,
`sync`, `rpc`), plus `crates/ui/src/file-icons.json` which the mobile layout
embeds at compile time.

## Build

Xcode 26 or newer, and a Rust toolchain with the iOS targets (`rust-toolchain.toml`
lists them):

```sh
cd apps/ios
xcodebuild -project Zeron.xcodeproj -scheme Zeron \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

The Zeron target's **Rust core** build phase runs `scripts/ios/build-core.sh`,
which builds `crates/mobile` for the active platform and refreshes
`apps/ios/Zeron/Core/Generated/zeron_core.swift`. `ZERON_SKIP_CORE=1` reuses
the last built library when iterating on Swift only.

A device archive for TestFlight is unsigned in CI and cloud-signed on export.
Locally, the project uses automatic signing. The checked-in team id is the
upstream default; the TestFlight workflow overrides `DEVELOPMENT_TEAM` with
the `APPLE_TEAM_ID` secret and the bundle id with `no.hideout.zremote`.

## Layout

```
apps/ios/          Xcode project (scheme Zeron)
scripts/ios/       build-core.sh — invoked by the Rust core build phase
crates/            Rust crates linked into libzeron_mobile.a
logos/             ZRemote app icon and wordmark
```

App sources and tests are described in [apps/ios/README.md](apps/ios/README.md).
