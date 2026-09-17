// Ported from zeron@853872d apps/ios/Zeron/Sync/ChatRoomClient.swift
// (constants mirrored from crates/sync/src/chat_client.rs).
//
// chat2 room client: binary frames over one WebSocket per chat to
// /chat2/{chatId}/ws — hello/state handshake with client-side checkpoint
// precision (the frontier payload decides fetch-vs-skip), cursor-based row
// backfill, push/ack with a pending-unacked batch queue, probe/redial
// liveness, reconnect with exponential backoff, and the HTTPS pull/push
// fallback cycle (the airplane-wifi transport).
//
// The client owns no CRDT semantics: update bytes flow through delegate
// closures into the session doc, which persists doc content AND the room
// cursor in one write (the C2 rule — they can never diverge).

import {
  decodeFrame,
  encodeFrame,
  FRAME,
  planCatchUp,
  parseChatStateHeader,
} from '../protocol/chatFrames';
import { newId } from '../doc/sessionDoc';
import {
  chat2CheckpointUrl,
  chat2PushUrl,
  chat2RowsUrl,
  chat2WsUrl,
  redactUrl,
  type EdgeConfig,
} from './edge';
import { edgeFetch, type FetchImpl, type FetchResponse } from './edgeHttp';
import type { Clock } from './clock';
import type { TokenSource } from './tokenSource';
import type { WsFactory, WsLike } from './ws';

// Constants mirrored from crates/sync/src/chat_client.rs (ms).
export const PING_INTERVAL_MS = 15_000;
export const SILENCE_LEASE_MS = 45_000;
export const HELLO_DEADLINE_MS = 15_000;
/** Checkpoint fetch + row backfill must complete within this deadline. */
export const BACKFILL_DEADLINE_MS = 120_000;
export const PROBE_DEADLINE_MS = 10_000;
export const PROBE_QUIET_MS = 900_000;
export const LIVENESS_TICK_MS = 1_000;
export const BACKOFF_BASE_MS = 250;
export const BACKOFF_CAP_MS = 16_000;
/** Stability-gated backoff reset: only a session that joined AND survived
 * this long earns a fresh 250ms — reset-on-join let connect-and-die
 * sockets hot-loop at 250ms forever. */
export const STABLE_RESET_MS = 30_000;
/** Re-push cadence after a `quota` rejection (server window is 60s). */
export const QUOTA_RETRY_MS = 5_000;
/** Client-side push cap: the DO's 1 MiB row cap minus header headroom —
 * an over-cap payload dies at the runtime with no error frame to retire it. */
export const MAX_PUSH_BYTES = 1024 * 1024 - 4096;
/** HTTPS pull cadence while unjoined (the WS-stripping-network transport). */
export const PULL_POLL_MS = 20_000;
const CHECKPOINT_ATTEMPTS = 4;
const MAX_GAP_REPAIRS = 3;

export type ChatRoomEvent =
  | { t: 'connected' }
  | { t: 'caughtUp'; headSeq: number }
  | { t: 'disconnected' }
  | { t: 'error'; code: string; message: string }
  | { t: 'presence'; device: string; at: number }
  | { t: 'pushAcked'; batchId: string; seq: number };

export interface ChatRoomDelegate {
  cursor(): number;
  containsFrontier(bytes: Uint8Array): boolean;
  /** Returns false on import failure (the session redials rather than run
   * blind). */
  applyCheckpoint(bytes: Uint8Array, seq: number): boolean;
  applyRow(bytes: Uint8Array, seq: number): void;
  advanceCursor(seq: number): void;
  /** Cursor amnesty: lower the cursor to the checkpoint seq (no-op if
   * already at or below). */
  clampCursor(seq: number): void;
  /** Assign the cursor outright — the catch-up plan's `after` IS the
   * cursor, down or UP. */
  setCursor(seq: number): void;
  onEvent(event: ChatRoomEvent): void;
}

export interface ChatRoomClientDeps {
  cfg: EdgeConfig;
  chatId: string;
  deviceId: string;
  wsFactory: WsFactory;
  tokenSource: TokenSource;
  clock: Clock;
  delegate: ChatRoomDelegate;
  fetchImpl?: FetchImpl;
  log?: (line: string) => void;
}

interface PendingPush {
  batchId: string;
  bytes: Uint8Array;
  /** In flight on the CURRENT connection (cleared on disconnect so
   * reconnects re-push; the server dedupes replays by batchId). */
  inFlight: boolean;
}

interface BufferedFrame {
  type: number;
  header: Record<string, unknown>;
  payload: Uint8Array;
}

export class ChatRoomClient {
  private socket: WsLike | undefined;
  private pending: PendingPush[] = [];
  /** State frame received on the CURRENT socket — pushes legal from here. */
  private stateReceived = false;
  /** Rows landing while a checkpoint downloads buffer here and replay after
   * the import. */
  private checkpointBuffer: BufferedFrame[] | undefined;
  /** One checkpoint download at a time, and it OUTLIVES socket redials. */
  private fetchInFlight = false;
  /** Once-per-client cursor amnesty (see handleState). */
  private cursorAmnestyDone = false;
  /** A row/ack with seq > cursor+1 flagged a hole; request a backfill. */
  private gapRepair = false;
  private gapRepairs = 0;
  /** Partial download preserved across fetch attempts (Range-resumed). */
  private partialCheckpoint: Uint8Array = new Uint8Array(0);
  private partialCheckpointSeq: string | undefined;
  /** Bytes moved on the checkpoint stream recently — progress IS liveness
   * while it runs; the silence lease defers to it. */
  private checkpointProgressAt: number | undefined;
  private joined = false;
  private joinedAt: number | undefined;
  private closed = false;
  private generation = 0;
  private backoffMs = BACKOFF_BASE_MS;
  /** First backfill of THIS client instance must NOT exclude own rows. */
  private resumed = false;
  private lastInbound: number;
  private lastProtocolRx: number;
  private helloSentAt: number | undefined;
  private backfillStartedAt: number | undefined;
  private probeSentAt: number | undefined;
  private timerHandles: unknown[] = [];

  constructor(private readonly deps: ChatRoomClientDeps) {
    this.lastInbound = deps.clock.now();
    this.lastProtocolRx = deps.clock.now();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    this.closed = false;
    this.connect().catch(() => {});
    // Pull-first bootstrap + poll-while-unjoined: one HTTPS GET catches the
    // doc up in ~1 RTT while the socket spends 4+ on TLS + upgrade + hello.
    this.schedulePull(0);
  }

  stop(): void {
    this.closed = true;
    this.generation += 1;
    this.clearTimers();
    this.socket?.close(1000, 'goingAway');
    this.socket = undefined;
    this.joined = false;
  }

  /** Queue one local update batch for push. Survives reconnects until
   * acked — the server dedupes replays by batchId. Batches over
   * MAX_PUSH_BYTES are refused here (queued-forever replays are the wedge
   * class chat2 exists to kill). */
  enqueue(update: Uint8Array): void {
    if (update.length > MAX_PUSH_BYTES) {
      this.log(
        `chat2 ${this.deps.chatId}: update ${update.length}B exceeds the row cap; not queued`,
      );
      return;
    }
    this.pending.push({ batchId: newId(), bytes: update, inFlight: false });
    if (this.stateReceived) this.pushPending();
  }

  /** Foreground hook: a dead or unjoined session redials NOW on fresh
   * backoff; a joined one gets a deadline-checked probe. */
  kick(): void {
    if (this.closed) return;
    this.backoffMs = BACKOFF_BASE_MS;
    if (this.socket === undefined) {
      this.connect().catch(() => {});
      return;
    }
    if (!this.joined) {
      // A handshake/catch-up already in flight is policed by its own
      // deadlines (hello 15s, backfill 120s). Only a zombie socket with NO
      // handshake pending is redialed.
      if (
        this.helloSentAt === undefined &&
        this.backfillStartedAt === undefined
      ) {
        this.connect().catch(() => {});
      }
      return;
    }
    if (this.probeSentAt !== undefined) return;
    this.sendProbe();
  }

  get isJoined(): boolean {
    return this.joined;
  }

  // ── Connect ──────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.generation += 1;
    const gen = this.generation;
    this.joined = false;
    this.stateReceived = false;
    this.checkpointBuffer = undefined;
    this.helloSentAt = undefined;
    this.backfillStartedAt = undefined;
    this.probeSentAt = undefined;
    this.gapRepair = false;
    this.gapRepairs = 0;
    this.lastProtocolRx = this.deps.clock.now();
    for (const p of this.pending) p.inFlight = false;

    const token = await this.deps.tokenSource.currentToken();
    if (gen !== this.generation || this.closed) return;
    if (token === undefined) {
      this.log(
        `chat2 ${this.deps.chatId}: no socket URL (token unavailable); backing off`,
      );
      this.scheduleReconnect(gen);
      return;
    }
    const url = chat2WsUrl(this.deps.cfg, this.deps.chatId, this.deps.deviceId);
    this.log(`chat2 ${this.deps.chatId}: dial ${redactUrl(url)}`);
    const socket = this.deps.wsFactory(url, {
      Authorization: `Bearer ${token}`,
    });
    this.socket = socket;
    this.lastInbound = this.deps.clock.now();
    this.lastProtocolRx = this.deps.clock.now();

    socket.onopen = () => {
      if (gen !== this.generation) return;
      this.helloSentAt = this.deps.clock.now();
      this.sendFrame(
        encodeFrame(FRAME.hello, {
          cursor: this.deps.delegate.cursor(),
          device: this.deps.deviceId,
        }),
      );
    };
    socket.onmessage = m => {
      if (gen !== this.generation) return;
      if (typeof m.data !== 'string') this.handleFrame(m.data, gen);
      // "pong" text refreshes only the transport lease (lastInbound moves in
      // the caller); proves nothing about the DO.
    };
    socket.onclose = () => this.onSocketError(gen);
    socket.onerror = () => this.onSocketError(gen);

    this.every(gen, PING_INTERVAL_MS, () => this.pingTick(gen));
    this.every(gen, LIVENESS_TICK_MS, () => this.livenessTick(gen));
  }

  private onSocketError(gen: number): void {
    if (gen !== this.generation || this.closed || this.socket === undefined)
      return;
    this.log(
      `chat2 ${this.deps.chatId}: session ended (joined=${this.joined}); redialing in ${this.backoffMs}ms`,
    );
    this.joined = false;
    this.deps.delegate.onEvent({ t: 'disconnected' });
    this.scheduleReconnect(gen);
  }

  private scheduleReconnect(gen: number): void {
    if (gen !== this.generation || this.closed) return;
    // Clear BEFORE close: close() fires onclose synchronously on some
    // stacks, and a re-entrant onSocketError would double-book the backoff.
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1006, 'abnormal');
    this.clearTimers();
    if (
      this.joinedAt !== undefined &&
      this.deps.clock.now() - this.joinedAt >= STABLE_RESET_MS
    ) {
      this.backoffMs = BACKOFF_BASE_MS;
    }
    this.joinedAt = undefined;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CAP_MS);
    this.timerHandles.push(
      this.deps.clock.setTimeout(() => {
        if (gen === this.generation && !this.closed)
          this.connect().catch(() => {});
      }, delay),
    );
  }

  // ── Timers ───────────────────────────────────────────────────────────

  private every(gen: number, ms: number, tick: () => void): void {
    const loop = () => {
      if (gen !== this.generation || this.closed) return;
      tick();
      if (gen !== this.generation || this.closed) return;
      this.timerHandles.push(this.deps.clock.setTimeout(loop, ms));
    };
    this.timerHandles.push(this.deps.clock.setTimeout(loop, ms));
  }

  private clearTimers(): void {
    for (const h of this.timerHandles) this.deps.clock.clearTimeout(h);
    this.timerHandles = [];
  }

  private pingTick(gen: number): void {
    if (gen !== this.generation || this.socket === undefined) return;
    const silence = this.deps.clock.now() - this.lastInbound;
    // A checkpoint download that is still moving bytes owns the pipe —
    // pongs queueing behind it are not a dead socket.
    const fetchMoving =
      this.checkpointProgressAt !== undefined &&
      this.deps.clock.now() - this.checkpointProgressAt < SILENCE_LEASE_MS;
    if (silence > SILENCE_LEASE_MS && !fetchMoving) {
      this.log(
        `chat2 ${this.deps.chatId}: socket silent past lease; treating as dead`,
      );
      this.onSocketError(gen);
      return;
    }
    this.socket.send('ping');
  }

  private livenessTick(gen: number): void {
    if (gen !== this.generation || this.socket === undefined || this.closed)
      return;
    const now = this.deps.clock.now();
    if (
      this.helloSentAt !== undefined &&
      now - this.helloSentAt > HELLO_DEADLINE_MS
    ) {
      this.log(
        `chat2 ${this.deps.chatId}: no state frame within deadline; redialing`,
      );
      this.onSocketError(gen);
      return;
    }
    if (
      this.backfillStartedAt !== undefined &&
      now - this.backfillStartedAt > BACKFILL_DEADLINE_MS
    ) {
      this.log(
        `chat2 ${this.deps.chatId}: backfill did not complete within deadline; redialing`,
      );
      this.onSocketError(gen);
      return;
    }
    if (
      this.probeSentAt !== undefined &&
      now - this.probeSentAt > PROBE_DEADLINE_MS
    ) {
      this.log(
        `chat2 ${this.deps.chatId}: probe unanswered past deadline; redialing`,
      );
      this.onSocketError(gen);
      return;
    }
    if (
      this.joined &&
      this.probeSentAt === undefined &&
      now - this.lastProtocolRx > PROBE_QUIET_MS
    ) {
      this.sendProbe();
      this.lastProtocolRx = now;
    }
  }

  private sendProbe(): void {
    this.probeSentAt = this.deps.clock.now();
    this.sendFrame(encodeFrame(FRAME.probe, {}));
  }

  // ── Inbound ──────────────────────────────────────────────────────────

  private handleFrame(data: Uint8Array, gen: number): void {
    this.lastInbound = this.deps.clock.now();
    const frame = decodeFrame(data);
    if (frame === undefined) {
      this.log(`chat2 ${this.deps.chatId}: unparseable frame; redialing`);
      this.onSocketError(gen);
      return;
    }
    this.lastProtocolRx = this.deps.clock.now();
    this.probeSentAt = undefined;

    if (frame.type === FRAME.state) {
      this.handleState(frame, gen);
      return;
    }
    if (frame.type === FRAME.row || frame.type === FRAME.rowsDone) {
      if (this.checkpointBuffer !== undefined) {
        this.checkpointBuffer.push(frame);
        return;
      }
      this.applyRowFrame(frame);
      this.maybeRepairGap(gen);
      return;
    }
    if (frame.type === FRAME.ack) {
      const batchId =
        typeof frame.header.batchId === 'string'
          ? frame.header.batchId
          : undefined;
      const seq =
        typeof frame.header.seq === 'number' ? frame.header.seq : undefined;
      if (batchId === undefined || seq === undefined) return;
      const retired = this.pending.some(p => p.batchId === batchId);
      this.pending = this.pending.filter(p => p.batchId !== batchId);
      // A dup ack retires nothing — still worth the cursor lesson below.
      if (retired) this.deps.delegate.onEvent({ t: 'pushAcked', batchId, seq });
      // Contiguity rule, ack flavor: our batch landing at seq proves rows up
      // to seq exist SERVER-side, not that we hold the interleaved ones.
      const cursor = this.deps.delegate.cursor();
      if (seq > cursor + 1) {
        this.gapRepair = true;
        this.log(
          `chat2 ${this.deps.chatId}: ack gap (seq=${seq}, cursor=${cursor}); holding cursor`,
        );
      } else {
        this.deps.delegate.advanceCursor(seq);
      }
      // A grant after a quota rejection drains whatever the error handler
      // un-flagged.
      this.pushPending();
      this.maybeRepairGap(gen);
      return;
    }
    if (frame.type === FRAME.probeOk) return;
    if (frame.type === FRAME.presence) {
      const device =
        typeof frame.header.device === 'string' ? frame.header.device : '';
      const at = typeof frame.header.at === 'number' ? frame.header.at : 0;
      this.deps.delegate.onEvent({ t: 'presence', device, at });
      return;
    }
    if (frame.type === FRAME.error) {
      this.handleErrorFrame(frame.header, gen);
      return;
    }
    // Unknown server frame: tolerate (future protocol additions).
  }

  /** The hello answer: plan the catch-up (chat_client.rs run_session). */
  private handleState(frame: BufferedFrame, gen: number): void {
    const state = parseChatStateHeader(frame.header);
    if (state === undefined) {
      this.log(`chat2 ${this.deps.chatId}: malformed state header; redialing`);
      this.onSocketError(gen);
      return;
    }
    if (this.helloSentAt === undefined) return; // late duplicate — ignore
    this.helloSentAt = undefined;
    this.backfillStartedAt = this.deps.clock.now();

    const cursor = this.deps.delegate.cursor();
    if (cursor > state.headSeq) {
      // Server behind our cursor = room was reset/wiped. A viewer owes no
      // re-seed (that is the host's checkpoint duty) — treat cursor fresh.
      this.log(
        `chat2 ${this.deps.chatId}: server lost state (headSeq=${state.headSeq} < cursor=${cursor})`,
      );
    }
    // Presence rule: checkpoint SIZE, not seq — a seeded room's checkpoint
    // legitimately covers seq 0.
    const contained =
      state.checkpointSize === 0 ||
      this.deps.delegate.containsFrontier(frame.payload);
    // Cursor amnesty, once per client: a cursor above the checkpoint seq
    // claims history the doc may have silently parked. Clamp and refetch —
    // no-op re-imports, KB cost, converts a lying cursor into a true one.
    // Checkpoint-LESS rooms amnesty to ZERO (PR #172).
    if (!this.cursorAmnestyDone) {
      this.cursorAmnestyDone = true;
      this.deps.delegate.clampCursor(
        state.checkpointSize > 0 ? state.checkpointSeq : 0,
      );
    }
    const planCursor = this.deps.delegate.cursor();
    const plan = planCatchUp(planCursor, state, contained);
    this.stateReceived = true;
    let after: number;
    if (plan.kind === 'rowsOnly') {
      after = plan.after;
    } else {
      // Fetch in PARALLEL with the row backfill: the rows request goes out
      // now, rows landing mid-download buffer, and import + replay happen
      // when the bytes arrive.
      this.log(
        `chat2 ${this.deps.chatId}: fetching checkpoint (seq=${state.checkpointSeq}, ${state.checkpointSize}B, rows in parallel)`,
      );
      this.checkpointBuffer = [];
      if (!this.fetchInFlight) {
        this.fetchInFlight = true;
        const seq = state.checkpointSeq;
        this.completeCheckpointFetch(seq).catch(() => {});
      }
      after = plan.after;
    }
    // The plan's `after` IS the cursor now — down or UP. Without the raise,
    // the backfill's first row reads as a contiguity gap.
    this.deps.delegate.setCursor(after);
    this.sendFrame(
      encodeFrame(FRAME.rowsReq, { after, excludeOwn: this.resumed }),
    );
    // Pending pushes go before catch-up completes: batchId dedupe makes
    // replays no-ops and rows are CRDT-commutative.
    this.pushPending();
  }

  /** Import the fetched checkpoint blob, then replay buffered rows.
   * Deliberately not generation-guarded on the apply: the blob's content is
   * socket-independent, so a download that outlived its socket still
   * becomes progress. */
  private async completeCheckpointFetch(seq: number): Promise<void> {
    const bytes = await this.fetchCheckpoint();
    this.fetchInFlight = false;
    this.checkpointProgressAt = undefined;
    if (this.closed) return;
    if (bytes === undefined) {
      // Redial only if a session is actually waiting on this blob — a stale
      // failure must not kill a healthy rowsOnly session.
      if (this.checkpointBuffer !== undefined) {
        this.log(
          `chat2 ${this.deps.chatId}: checkpoint fetch failed (partial kept); redialing`,
        );
        this.checkpointBuffer = undefined;
        this.onSocketError(this.generation);
      }
      return;
    }
    if (!this.deps.delegate.applyCheckpoint(bytes, seq)) {
      if (!this.closed) {
        this.log(
          `chat2 ${this.deps.chatId}: checkpoint import failed; redialing`,
        );
        this.checkpointBuffer = undefined;
        this.onSocketError(this.generation);
      }
      return;
    }
    const buffered = this.checkpointBuffer;
    this.checkpointBuffer = undefined;
    if (buffered !== undefined) {
      for (const frame of buffered) {
        this.applyRowFrame(frame);
        if (this.closed) return;
      }
    }
    this.maybeRepairGap(this.generation);
  }

  /** One backfill/broadcast frame: a row, or the ROWS_DONE terminator. */
  private applyRowFrame(frame: BufferedFrame): void {
    if (frame.type === FRAME.row) {
      const seq =
        typeof frame.header.seq === 'number' ? frame.header.seq : undefined;
      if (seq === undefined) return;
      // CONTIGUITY RULE (PR #172): the cursor claims "every row ≤ cursor is
      // reflected in the doc", so it may only walk, never jump. A gap means
      // rows we never received — apply the bytes (loro parks dependents
      // harmlessly), hold the honest cursor, ask for a backfill repair.
      const cursor = this.deps.delegate.cursor();
      if (seq > cursor + 1) {
        this.gapRepair = true;
        this.log(
          `chat2 ${this.deps.chatId}: row gap (seq=${seq}, cursor=${cursor}); holding cursor`,
        );
        this.deps.delegate.applyRow(frame.payload, cursor);
      } else {
        this.deps.delegate.applyRow(frame.payload, seq);
      }
      return;
    }
    if (this.backfillStartedAt === undefined) return;
    this.backfillStartedAt = undefined;
    const wasResumed = this.resumed;
    this.resumed = true;
    this.joined = true;
    this.joinedAt = this.deps.clock.now();
    this.log(
      `chat2 ${this.deps.chatId}: joined (converged, resumed=${wasResumed})`,
    );
    this.deps.delegate.onEvent({
      t: 'caughtUp',
      headSeq: this.deps.delegate.cursor(),
    });
    this.deps.delegate.onEvent({ t: 'connected' });
    this.pushPending();
  }

  /** If a row/ack gap was flagged, request a backfill from the honest
   * cursor. Bounded per session: exhaustion forces a redial (full
   * catch-up is the stronger repair). */
  private maybeRepairGap(gen: number): void {
    if (
      !this.gapRepair ||
      gen !== this.generation ||
      this.socket === undefined ||
      !this.stateReceived
    ) {
      return;
    }
    this.gapRepair = false;
    this.gapRepairs += 1;
    if (this.gapRepairs > MAX_GAP_REPAIRS) {
      this.log(
        `chat2 ${this.deps.chatId}: gap repairs exhausted; redialing for a full catch-up`,
      );
      this.onSocketError(gen);
      return;
    }
    const after = this.deps.delegate.cursor();
    this.sendFrame(encodeFrame(FRAME.rowsReq, { after, excludeOwn: false }));
  }

  private handleErrorFrame(header: Record<string, unknown>, gen: number): void {
    const code = typeof header.code === 'string' ? header.code : '?';
    const message = typeof header.message === 'string' ? header.message : '';
    const batchId = typeof header.batchId === 'string' ? header.batchId : '';
    this.log(
      `chat2 ${this.deps.chatId}: server rejected a frame: ${code}: ${message}`,
    );
    this.deps.delegate.onEvent({ t: 'error', code, message });
    switch (code) {
      case 'too_large':
      case 'empty':
      case 'bad_push':
        // Permanent verdicts on a specific batch: retire it, or it replays
        // on every reconnect forever.
        if (batchId !== '') {
          this.pending = this.pending.filter(p => p.batchId !== batchId);
        }
        break;
      case 'quota':
        // Transient: keep the batch queued and probe with the HEAD batch on
        // a short clock (one-per-grant; a full-queue replay would itself
        // consume the server's quota window).
        for (const p of this.pending) p.inFlight = false;
        this.timerHandles.push(
          this.deps.clock.setTimeout(() => this.pushHead(gen), QUOTA_RETRY_MS),
        );
        break;
      case 'hello_first':
        // Session state desynced from the server — start over.
        this.onSocketError(gen);
        break;
      default:
        break;
    }
  }

  // ── Outbound ─────────────────────────────────────────────────────────

  private pushPending(): void {
    if (!this.stateReceived) return;
    for (const p of this.pending) {
      if (!p.inFlight) {
        p.inFlight = true;
        this.sendFrame(
          encodeFrame(FRAME.push, { batchId: p.batchId }, p.bytes),
        );
      }
    }
  }

  /** Send only the queue's head batch — the quota-probe path. */
  private pushHead(gen: number): void {
    const head = this.pending[0];
    if (gen !== this.generation || !this.joined || head === undefined) return;
    head.inFlight = true;
    this.sendFrame(
      encodeFrame(FRAME.push, { batchId: head.batchId }, head.bytes),
    );
  }

  private sendFrame(bytes: Uint8Array): void {
    try {
      this.socket?.send(bytes);
    } catch {
      // send races teardown; the receive error drives the redial.
    }
  }

  // ── Checkpoint fetch (GET /chat2/{id}/checkpoint, Range resume) ──────

  /**
   * Range-resume loop (chat2_host EdgeCheckpointFetcher): each attempt
   * continues at the byte where the last one stopped; the DO stamps every
   * response with the checkpoint's seq, and a mid-download replacement
   * restarts from 0 (a Range against a new blob would splice two blobs).
   */
  private async fetchCheckpoint(): Promise<Uint8Array | undefined> {
    let got = this.partialCheckpoint;
    let seenSeq = this.partialCheckpointSeq;
    const keepPartial = () => {
      this.partialCheckpoint = got;
      this.partialCheckpointSeq = seenSeq;
    };
    for (let attempt = 0; attempt < CHECKPOINT_ATTEMPTS; attempt++) {
      const headers: Record<string, string> = {};
      if (got.length > 0) headers.Range = `bytes=${got.length}-`;
      let res: FetchResponse;
      try {
        res = await edgeFetch(
          chat2CheckpointUrl(this.deps.cfg, this.deps.chatId),
          this.deps.tokenSource,
          { method: 'GET', headers },
          this.deps.fetchImpl,
        );
      } catch {
        continue;
      }
      const seq = res.headers.get('x-chat2-checkpoint-seq');
      if (seq !== null) {
        if (seenSeq !== undefined && seq !== seenSeq) {
          this.log(
            `chat2 ${this.deps.chatId}: checkpoint replaced mid-download; restarting`,
          );
          got = new Uint8Array(0);
          seenSeq = seq;
          continue;
        }
        seenSeq = seq;
      }
      if (res.status === 200) {
        got = new Uint8Array(0);
      } else if (res.status !== 206) {
        this.log(`chat2 ${this.deps.chatId}: checkpoint HTTP ${res.status}`);
        keepPartial();
        return undefined;
      }
      try {
        const chunk = new Uint8Array(await res.arrayBuffer());
        const merged = new Uint8Array(got.length + chunk.length);
        merged.set(got);
        merged.set(chunk, got.length);
        got = merged;
        this.checkpointProgressAt = this.deps.clock.now();
        this.partialCheckpoint = new Uint8Array(0);
        this.partialCheckpointSeq = undefined;
        return got;
      } catch {
        // Mid-body drop: keep the bytes, resume via Range.
        this.log(
          `chat2 ${this.deps.chatId}: checkpoint stream dropped at ${got.length}B; resuming`,
        );
      }
    }
    keepPartial();
    return undefined;
  }

  // ── HTTPS pull/push fallback (the WS-stripping-network transport) ────

  private schedulePull(ms: number): void {
    this.timerHandles.push(
      this.deps.clock.setTimeout(() => {
        if (this.closed) return;
        this.pullSync().catch(() => {});
        this.timerHandles.push(
          this.deps.clock.setTimeout(() => {
            if (!this.closed && !this.joined) this.pullSync().catch(() => {});
            this.schedulePull(PULL_POLL_MS);
          }, PULL_POLL_MS),
        );
      }, ms),
    );
  }

  /**
   * One HTTPS sync cycle: flush pending batches (POST — batchId dedupe
   * makes replays no-ops), then pull rows (GET) and apply them through the
   * exact frame path the socket uses.
   */
  async pullSync(): Promise<void> {
    if (this.closed) return;
    // Push first: a message typed on dead wifi leaves on this cycle.
    for (const push of [...this.pending]) {
      const url = chat2PushUrl(
        this.deps.cfg,
        this.deps.chatId,
        this.deps.deviceId,
        push.batchId,
      );
      let res: FetchResponse;
      try {
        res = await edgeFetch(
          url,
          this.deps.tokenSource,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: push.bytes,
          },
          this.deps.fetchImpl,
        );
      } catch {
        break; // transport error — retry next cycle
      }
      const text = await res.text().catch(() => '');
      let body: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null)
          body = parsed as Record<string, unknown>;
      } catch {
        /* non-JSON body */
      }
      if (res.status === 200 && typeof body.seq === 'number') {
        this.pending = this.pending.filter(p => p.batchId !== push.batchId);
        const cursor = this.deps.delegate.cursor();
        if (body.seq <= cursor + 1) {
          this.deps.delegate.advanceCursor(body.seq);
        } else {
          this.log(
            `chat2 ${this.deps.chatId}: http ack gap (seq=${body.seq}, cursor=${cursor}); holding cursor`,
          );
        }
      } else if (
        typeof body.error === 'string' &&
        ['bad_push', 'too_large', 'empty'].includes(body.error)
      ) {
        // Permanent verdict — provably OUR edge's (a parsed error code, not
        // a middlebox's arbitrary 4xx). Retire; the ops stay in the doc.
        this.pending = this.pending.filter(p => p.batchId !== push.batchId);
      } else {
        break; // quota/transient/middlebox: retry next cycle
      }
    }
    const after = this.deps.delegate.cursor();
    const url = chat2RowsUrl(
      this.deps.cfg,
      this.deps.chatId,
      this.deps.deviceId,
      after,
    );
    let res: FetchResponse;
    try {
      res = await edgeFetch(
        url,
        this.deps.tokenSource,
        { method: 'GET' },
        this.deps.fetchImpl,
      );
    } catch {
      return; // transport error — retry next cycle
    }
    if (res.status !== 200) return;
    const body = new Uint8Array(await res.arrayBuffer());
    // u32-LE length-prefixed frames: state first, then rows, rowsDone.
    const frames: BufferedFrame[] = [];
    let off = 0;
    while (off + 4 <= body.length) {
      const len = new DataView(body.buffer, body.byteOffset + off).getUint32(
        0,
        true,
      );
      off += 4;
      if (off + len > body.length) break;
      const frame = decodeFrame(body.subarray(off, off + len));
      if (frame !== undefined) frames.push(frame);
      off += len;
    }
    const stateFrame = frames[0];
    const state =
      stateFrame !== undefined
        ? parseChatStateHeader(stateFrame.header)
        : undefined;
    if (
      stateFrame === undefined ||
      stateFrame.type !== FRAME.state ||
      state === undefined
    ) {
      this.log(
        `chat2 ${this.deps.chatId}: http pull body malformed (${body.length}B, ${frames.length} frames)`,
      );
      return;
    }
    if (!this.cursorAmnestyDone) {
      this.cursorAmnestyDone = true;
      this.deps.delegate.clampCursor(
        state.checkpointSize > 0 ? state.checkpointSeq : 0,
      );
    }
    const planAfter = this.deps.delegate.cursor();
    const contained =
      state.checkpointSize === 0 ||
      this.deps.delegate.containsFrontier(stateFrame.payload);
    if (
      planCatchUp(planAfter, state, contained).kind === 'checkpointThenRows'
    ) {
      // Route through completeCheckpointFetch — NOT an inline fetch: the
      // socket handshake may race this pull and arm checkpointBuffer
      // expecting the completion path to drain it.
      if (this.fetchInFlight) return; // socket's fetch owns it
      this.fetchInFlight = true;
      await this.completeCheckpointFetch(state.checkpointSeq);
      if (this.closed) return;
      if (!this.deps.delegate.containsFrontier(stateFrame.payload)) {
        this.log(
          `chat2 ${this.deps.chatId}: http pull — frontier still missing after checkpoint; will retry`,
        );
        return;
      }
    }
    for (const frame of frames.slice(1)) {
      if (frame.type === FRAME.row || frame.type === FRAME.rowsDone)
        this.applyRowFrame(frame);
    }
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }
}
