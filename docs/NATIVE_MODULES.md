# Native modules

All Swift in this repository is **implemented-but-unverified**: it was
written on Windows against the loro-swift 1.13.3 / ActivityKit / Speech API
surfaces and has never been compiled. First build happens on a Mac.

## Modules

| Module | Path | Purpose |
| --- | --- | --- |
| `react-native-loro` | `app/modules/react-native-loro` | Nitro `LoroDoc` HybridObject over loro-swift 1.13.3 — the `LoroDocPort` backing on iOS |
| `zeron-dictation` | `app/modules/zeron-dictation` | On-device speech dictation (SFSpeechRecognizer, `requiresOnDeviceRecognition`) |
| Live Activities | `app/src/liveActivity/*` | expo-widgets `ZeronSession` activity (no custom native code — ActivityKit comes from expo-widgets) |

### react-native-loro

- `src/LoroDoc.nitro.ts` — the Nitro spec (`HybridObject<{ios:'swift'}>`);
  `nitrogen/generated/` is committed glue (`npx nitrogen` regenerates).
- `ios/HybridLoroDoc.swift` — the bridge. Mirrors
  `apps/ios/Zeron/Sync/SessionStore.swift`/`SessionQueue.swift` at zeron
  853872d: `importWith(bytes:origin:"remote")`,
  `export(mode: .updates(from:)/.snapshot)`, `oplogVv()`,
  `VersionVector.decode` + `includesVv` (decode-fail and decoded-empty both
  ⇒ `false`, the vacuous-claim rule), `getDeepValue().jsonObject`,
  `subscribeLocalUpdate`, `insertMapContainer`, movable-list ops.
- `ios/LoroValueJSON.swift` — `LoroValue ⇄ JSON` (ported from Zeron's
  `LoroValueJSON.swift`; binary → base64 string).
- `vendor/loro-swift/Sources/Loro/*.swift` — vendored binding sources from
  tag 1.13.3 (`vendor/loro-swift/SOURCE.md` records revision + LICENSE).
- `vendor/loroFFI.xcframework` — the FFI binary, **not committed**. Fetch +
  sha256 verify via `app/scripts/fetch-loro-ffi.sh` (checksum
  `fc55bfb8…9be2`, see docs/COMPATIBILITY.md). The podspec runs it as a
  `prepare_command`.
- `src/index.ts` — `createNativeLoroDoc(): LoroDocPort`, the
  ArrayBuffer↔Uint8Array / JSON-string adapter.

### zeron-dictation

- `src/Dictation.nitro.ts` — spec: `isSupported`, `modelState`,
  `downloadModel`, `start(locale, onPartial, onFinal, onError)`,
  `stop`, `cancel`.
- `ios/HybridDictation.swift` — SFSpeechRecognizer path (iOS 17+,
  on-device only — never server recognition). The iOS 26
  SpeechAnalyzer/SpeechTranscriber path is sketched but left as a
  `TODO(macOS build)` inside `#available` guards. No audio touches disk;
  the engine is released on stop/cancel and on AVAudioSession
  interruption/route change.
- Settings → Dictation shows the model state for `uiPrefs.dictationLocale`
  and offers "Download offline model" when downloadable.

### Live Activities

- `src/liveActivity/SessionActivity.tsx` — the `'widget'` component:
  Lock Screen banner + Dynamic Island (compact/minimal/expanded) via
  `@expo/ui/swift-ui`. Distinct visuals: awaitingInput amber, errored red,
  completed green, stale dimmed; indeterminate progress without task
  counts.
- `src/liveActivity/liveActivityManager.ts` — pure policy (`planActivity`
  + `LiveActivityManager`): dedupe by chatId, working updates throttled to
  1/5s, urgent phases immediate, `completed` → end `after(now+30min)`,
  archive → `immediate`, stale-date now+120s.
  **Fallback:** if `start()` throws (OS limit/disabled), one aggregate
  activity is used for the currently-selected session.
- `src/liveActivity/bindLiveActivities.ts` — store wiring + push-token
  registration (`/registry/{org}/live-activity`, see
  `docs/HOST_EDGE_CHANGES.md`); push-to-start tokens register with
  `chatId: "*"`; rotation rides `addPushTokenListener`; unregister on
  end/sign-out.
- Settings → Live Activities: on/off + "Show host and project on Lock
  Screen" (the privacy default — `showContext`).

## macOS build steps

```sh
cd app
./scripts/fetch-loro-ffi.sh      # vendored FFI binary + checksum
npx expo prebuild                # generates ios/ + widget extension
cd ios && pod install            # picks up ReactNativeLoro + ZeronDictation pods
xcodebuild -workspace <app>.xcworkspace -scheme <app> -destination 'platform=iOS Simulator'
```

`expo-build-properties` `ios.useFrameworks` is intentionally **unset** —
Nitro's generated pods (`react-native-nitro-modules` + autolinking.rb from
nitrogen) do not support `useFrameworks: static`; leave it off.

## Unverified on Windows

- All Swift compilation (`HybridLoroDoc`, `LoroValueJSON`, `HybridDictation`).
- ActivityKit rendering, Dynamic Island, push token delivery/rotation.
- Nitro WS (`nitroWs.ts`), SpeechAnalyzer path, FFI loading.
