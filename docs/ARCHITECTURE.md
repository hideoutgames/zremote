# Zeron for iPhone and iPad — architecture

The phone is a **peer device** on the Zeron mesh: it joins the same edge rooms
as every other device, renders synchronized state, and drives remote engines
through the durable command ledger. No agent, repository operation, or
terminal runs on the phone. Local speech transcription does.

```
                 ┌──────────────────────── Cloudflare edge ────────────────────────┐
                 │  /auth/*        /registry/{org}/ws     /chat2/{chat}/ws          │
                 │  WorkOS         RegistryRoom (rows)    ChatRoom (Loro rows)      │
                 │                 /device/{id}/ws  DeviceRoom (relay, nudge)       │
                 └──────────┬──────────────┬──────────────────┬────────────────────┘
                            │              │                  │
   iPhone / iPad            │              │                  │        Host machine
   ┌───────────────┐   auth │     registry │            chat2 │        ┌──────────────┐
   │ UI (RN)       │ ◄──────┼──────────────┼──────────────────┼──────► │ zeron engine │
   │ state (zustand│        │              │                  │        │ agents, git, │
   │ doc mirror)   │ ────── ControlRpc over device-room relay ───────► │ terminals    │
   └───────────────┘                                                   └──────────────┘
```

## Layers (`app/src`)

| Layer | Path | Rules |
| --- | --- | --- |
| Protocol codecs and wire types | `zeron/protocol/` | Pure functions and types ported from the pinned Zeron sources (`chatFrames.ts`, `registryCore.ts`, `deviceFrames.ts`, `rpc.ts`, `types.ts`, `commands.ts`, `messages.ts`). No I/O, no React. Every file names its Zeron source. |
| Doc port | `zeron/doc/` | `LoroDocPort` interface + `loro-crdt` adapter (Node) + native adapter (iOS). `sessionDoc.ts` projects a doc into entries/commands/queue and performs the phone's only writes (append command entries, queue rows). `registryDoc.ts` is the client-side row table with a pending-op overlay. |
| Transports | `zeron/transport/` | `edgeHttp.ts` (fetch + bearer + single-flight refresh), `registryClient.ts`, `chatRoomClient.ts`, `deviceRelayClient.ts`, `ws.ts` (WebSocket factory: NitroWebSocket on device, `ws` in Node). Reconnect/backoff/liveness discipline mirrors `crates/sync` and the Swift client. |
| Auth | `zeron/auth/` | AuthKit authorize URL, state binding, PKCE, exchange/refresh/orgs, `SecureStorePort`, the `SignedOut → NeedsOrganization → SignedIn` state machine. |
| Synchronized domain state | `zeron/state/` | zustand stores fed only by the layers above: `authStore`, `workspaceStore` (devices/spaces/chats/sessions + derived indicator/sort), `sessionStores` (one per open chat: entries, commands, run status, pending optimistic sends), `catalogStore` (per-device `ListHarnesses`/`ListModels`), `draftStore` (per-session drafts + staged attachments, persisted per account). |
| Native services | `zeron/native/` and `app/modules/*` | `react-native-loro` (Nitro over loro-swift), `zeron-dictation` (SpeechAnalyzer / on-device SFSpeechRecognizer), Live Activities (`expo-widgets`), secure storage, haptics. Each has a JS port interface so Jest runs without them. |
| Presentation | `screens/`, `components/`, `components/agentsKit/` | Views receive typed domain state and callbacks; they never touch frames, sockets, or Loro. `components/agentsKit/` is the native adaptation of Agents Kit components (see `docs/AGENTS_KIT_PROVENANCE.md`). |

## Identity and scoping

- **Account** = WorkOS user (`sub`) inside an **organization** (`org_id` claim). All caches, drafts, doc snapshots, registry snapshots, and push registrations are keyed by `{orgId}/{userId}`; sign-out closes rooms, removes Live Activity registrations, and isolates (does not merge) the cache.
- **Device** = a UUID minted once per install and stored in secure storage. It stamps registry ops (HLC suffix), command `issuedBy`, and the `device` field on chat2/registry hellos. The phone never writes an engine `devices` row.
- **Space** = (deviceId, folder) row. **Chat/session** = registry `chats` row (+ `sessions` status row) and its chat2 Loro doc. **Checkout** = `cwd`/`branch`/`checkoutId` on the chat row.
- **Run / turn / message** ids come from the doc; the phone mints message ids for optimistic echo (`run.messageId`), command ids, and upload ids.

## Command plane

`run`, `steer`, `interrupt`, `respondInput` are append-only entries in the
session doc's `commands` list (schema in `crates/doc/src/commands.rs`). The
phone writes `{id, kind, payload, issuedBy, issuedAt, basedOn?, expiresAt,
status:"pending"}`, commits, pushes the Loro update as a chat2 row, and POSTs a
durable nudge to the host's device room. Only the host writes outcomes
(`applied|rejected|expired|superseded`); the phone may set `cancelled` on its
own still-pending entries. UI status derives from: local commit → chat2 ack
(synchronized) → command status from the host → session status row
(`working|awaitingInput|errored|idle`, staleness-gated at 45 s) → message
`streaming|complete|aborted`. A queued interrupt is shown as "Stopping…" until
the host marks it applied and the session row leaves `working`.

Optimistic user entries share the command's `messageId`; when the host writes
the real entry with that id the pending echo is dropped, never duplicated.

## Attachments

Bytes never ride the doc. Images/files are staged on the **host device** over
the relay (`UploadChunk` → `UploadCommit` → durable path) or, on hosts that
advertise `message-queue-attachments-v1`, referenced as `pending://{uploadId}/{name}`
while the bytes chase the command. The run request carries both the
`attachments` paths and the `Attached images (local files …)` prompt trailer,
matching desktop. Device-local URIs are never sent to a host.

## Background continuity

The app never keeps a background socket alive. Hosts execute independently;
when the app returns to the foreground each open room re-hellos with its
persisted cursor and reconciles (rows since cursor, checkpoint if the frontier
is not contained). Live Activities are updated by APNs pushes produced host/edge
side (see `docs/HOST_EDGE_CHANGES.md`); the app only registers per-activity
push tokens and deep-links back to the exact session.
