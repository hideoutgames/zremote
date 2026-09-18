# Verification gate — final run

- Date: 2026-09-18T00:28Z
- Commit: `f6b39a9` (working tree contains the uncommitted Stage 1–8b changes)
- Pinned Zeron rev: `853872d` (engine binary reports v0.2.72)
- Machine: Windows (all checks below are the Windows-verifiable gate;
  native iOS compilation is Mac-only — see ../STATUS.md)

## Real E2E (`npm run e2e:windows` in `app/`)

Full log in [e2e-report.md](e2e-report.md). 10/10 steps passed against a real
`wrangler dev` edge + real `zeron.exe` (mock harness):

| Step                                                        | Result | Time   |
| ----------------------------------------------------------- | ------ | ------ |
| 1. edge+engine startup, device row                          | PASS   | 2908ms |
| 2. relay RPC catalog (ListHarnesses/ListModels/ListFolders) | PASS   | 98ms   |
| 3. createSpace via Mutate                                   | PASS   | 51ms   |
| 4. createChat via registry                                  | PASS   | 264ms  |
| 5. run command to completion (working→idle)                 | PASS   | 1557ms |
| 6. interrupt mid-run                                        | PASS   | 4356ms |
| 7. question/approval round-trip                             | PASS   | 2291ms |
| 8. reconnect/replay — second phone converges                | PASS   | 2217ms |
| 9. steer mid-run                                            | PASS   | 6414ms |
| 10. registry mutations converge (rename/archive/seen)       | PASS   | 1056ms |

Regression found and fixed this run: `wrangler dev` persists registry DO
state between runs, so a stale `e2e-host` device row satisfied
`waitForHostRow` before the live engine joined; the phone then dialed a dead
device id (`RelayError: The device is offline`). Fixed in
`app/scripts/e2e/run.ts` — the host-row wait now also requires presence
within the 45s freshness window.

## Gates

```
npm run lint                    → 0 errors, 0 warnings        (exit 0)
npx tsc --noEmit                → clean                       (exit 0)
npm test -- --ci                → 48 suites / 337 tests pass  (exit 0)
npm run format:check            → all files clean             (exit 0)
npm run react-compiler-check    → 56/56 components compile    (exit 0)
```

### `npx expo config --type introspect` (first lines)

```
» android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature.
» ios: groupIdentifier: Expo Widgets: No group identifier provided, using fallback: group.sh.zeron.mobile.
» ios: bundleIdentifier: Expo Widgets: No bundle identifier provided, using fallback: sh.zeron.mobile.ExpoWidgetsTarget.
{ name: 'Zeron', … }
```

### `node scripts/prebuild-ios-windows.js --clean` (last lines)

```
- Creating native directory (./ios)
✔ Created native directory
- Updating package.json
✔ Updated package.json | no changes
- Running prebuild
» ios: groupIdentifier: Expo Widgets: No group identifier provided, using fallback: group.sh.zeron.mobile.
- Running prebuild
» ios: bundleIdentifier: Expo Widgets: No bundle identifier provided, using fallback: sh.zeron.mobile.ExpoWidgetsTarget.
- Running prebuild
✔ Finished prebuild
```

### Edge worktree unit tests (`_ref/zeron-edge-patch/edge`, `npm run test:unit`)

```
Test Files  9 passed (9)
     Tests  53 passed (53)
  Duration  977ms
```

Includes the Stage-7 patch coverage: `live-activity.test.ts` (8) and
`edge-patches.test.ts` (4).
