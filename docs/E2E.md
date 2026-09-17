# Windows E2E harness

`app/scripts/e2e/` drives the TypeScript `src/zeron/**` client stack as a real
"phone" peer against a real `wrangler dev` edge and the real Zeron engine
binary — the same topology as the upstream `scripts/e2e-smoke.sh`, but with our
ported client in place of the Rust driver.

## Run it

```sh
cd app
npm run e2e:windows        # == npx tsx scripts/e2e/run.ts
```

## Required paths

- Edge checkout with `npm install` done: `../_ref/zeron/edge` (wrangler 4.x).
- Engine binary: `../_ref/zeron-bin/zeron.exe` (0.2.72+).
- Space dir `../_ref/e2e-space` is created automatically (and `git init`'d
  when git is on PATH).
- `.e2e/bin/` may carry `msvcp140.dll` / `vcruntime140*.dll` — needed when the
  machine lacks the MSVC redistributable (workerd.exe and zeron.exe fail with
  `STATUS_DLL_NOT_FOUND` otherwise). The harness prepends it to the child
  `PATH`.

## What it proves (10 steps, stops on first failure)

1. Edge + engine startup; the registry room surfaces the engine's `devices`
   row (name/version/capabilities).
2. Device-relay RPC catalog: `ListHarnesses` (contains `mock`),
   `ListModels {harness:'mock'}`, `ListFolders {}` — verbatim JSON shapes are
   recorded in the report for the catalog UI.
3. `Mutate {op:'createSpace'}` over the relay; the `spaces` row arrives via
   the registry.
4. Chat created by a registry `upsert` (`buildCreateChatSet`, `roomGen: 2`,
   `config {harness:'mock'}`) — no engine IPC involved.
5. Durable `run` command → pushed, acked, host nudged; user message +
   completed assistant entry; command `applied`; session `working` → `idle`.
6. `interrupt` mid-run (engine restarted with `ZERON_MOCK_DELAY_MS`).
7. `respondInput` against `ZERON_MOCK_QUESTION=1` (session `awaitingInput`).
8. Reconnect/replay: phone #1 goes dark, phone #2 (distinct deviceId) queues
   a run, phone #1 rehydrates a **fresh** `SessionDoc` from a persisted
   snapshot+cursor and converges to the identical projection.
9. `steer` mid-run — terminal command status recorded.
10. Registry writes (rename/archive/unarchive/markSeen) converge after ack.

## Mock knobs (engine env, see `crates/harness/src/mock.rs`)

`ZERON_MOCK_DELAY_MS` (per-event spacing — makes runs interruptible),
`ZERON_MOCK_QUESTION=1` (emits single+multi-select questions and waits),
`ZERON_MOCK_CHARS`, `ZERON_MOCK_THINKING`, `ZERON_MOCK_ERROR`,
`ZERON_MOCK_TABLE`, `ZERON_MOCK_CODE`, `ZERON_MOCK_MEND`,
`ZERON_MOCK_SUBAGENT`, `ZERON_MOCK_REPEAT`. The harness restarts the engine
(with a stable `ZERON_DATA_DIR`, so its deviceId persists) to apply them.

## Edge reuse / teardown

If `GET /health` on `:27640` already returns `{"auth":"dev"}`, the edge is
reused and left running. Otherwise the spawned `wrangler dev` and the engine
process trees are killed (`taskkill /T /F`) on exit.

## Artifacts

- `.e2e/report.md` — per-step pass/fail, timings, verbatim JSON snapshots
  (catalog replies, Mutate params/results, rows, transcript entries,
  command ledger states), plus log tails.
- `.e2e/logs/` — `edge.log`, `engine*.log`.
