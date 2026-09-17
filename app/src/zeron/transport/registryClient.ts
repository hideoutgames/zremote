// Ported from zeron@853872d apps/ios/Zeron/Sync/RegistryClient.swift
// (constants mirrored from crates/sync/src/registry.rs).
//
// Registry room client: JSON text frames over one WebSocket to
// /registry/{orgId}/ws — hello/cursor handshake, push/ack for pending op
// batches, merged-row broadcasts, presence beats, probe/redial liveness,
// reconnect with backoff. Owns no row semantics: everything flows to the
// delegate (the RegistryDoc).
//
// Liveness discipline: the text "ping" elicits a runtime auto-pong that
// proves NOTHING about the DO (2026-07-30), so room health is judged only
// by protocol frames — a probe unanswered past its deadline tears the
// session down for a fresh dial.

import type { Row } from '../protocol/registryCore';
import type { RegistryPendingBatch } from '../doc/registryDoc';
import { encodeClientFrame, type ServerFrame } from '../protocol/registryWire';
import {
  redactUrl,
  registryPushUrl,
  registryRowsUrl,
  registryWsUrl,
  type EdgeConfig,
} from './edge';
import { edgeFetchJson, type FetchImpl } from './edgeHttp';
import type { Clock } from './clock';
import type { TokenSource } from './tokenSource';
import type { WsFactory, WsLike } from './ws';

// Constants mirrored from crates/sync/src/registry.rs (ms).
export const PING_INTERVAL_MS = 15_000;
export const PRESENCE_INTERVAL_MS = 15_000;
export const SILENCE_LEASE_MS = 45_000;
export const HELLO_DEADLINE_MS = 15_000;
export const PROBE_DEADLINE_MS = 10_000;
/** 15-min quiet-room probe. */
export const PROBE_QUIET_MS = 900_000;
export const LIVENESS_TICK_MS = 1_000;
export const BACKOFF_BASE_MS = 250;
export const BACKOFF_CAP_MS = 16_000;
/** Stability-gated backoff reset: only a session that joined AND survived
 * this long earns a fresh 250ms. */
export const STABLE_RESET_MS = 30_000;

export type RegistryEvent =
  | {
      t: 'state';
      seq: number;
      full: boolean;
      gcFloor: number;
      rows: Row[];
      presence: Record<string, number>;
    }
  | { t: 'connected' }
  | { t: 'rows'; seq: number; rows: Row[] }
  | { t: 'ack'; batch: string; seq: number; applied: number }
  | { t: 'presence'; device: string; at: number }
  | { t: 'disconnected' };

export interface RegistryDelegate {
  helloCursor(): number | undefined;
  takePushable(): RegistryPendingBatch[];
  onEvent(event: RegistryEvent): void;
}

export interface RegistryClientDeps {
  cfg: EdgeConfig;
  orgId: string;
  deviceId: string;
  wsFactory: WsFactory;
  tokenSource: TokenSource;
  clock: Clock;
  delegate: RegistryDelegate;
  fetchImpl?: FetchImpl;
  log?: (line: string) => void;
}

export class RegistryClient {
  private socket: WsLike | undefined;
  private joined = false;
  private joinedAt: number | undefined;
  private closed = false;
  private generation = 0;
  private backoffMs = BACKOFF_BASE_MS;
  /** Transport clock — any inbound counts (pongs refresh the lease). */
  private lastInbound: number;
  /** Protocol clock — only real frames count (pongs prove nothing). */
  private lastProtocolRx: number;
  private helloSentAt: number | undefined;
  private probeSentAt: number | undefined;
  private timerHandles: unknown[] = [];

  constructor(private readonly deps: RegistryClientDeps) {
    this.lastInbound = deps.clock.now();
    this.lastProtocolRx = deps.clock.now();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  start(): void {
    this.closed = false;
    this.connect().catch(() => {});
  }

  stop(): void {
    this.closed = true;
    this.generation += 1;
    this.clearTimers();
    this.socket?.close(1000, 'goingAway');
    this.socket = undefined;
    this.joined = false;
  }

  /** Local writes were enqueued — push pending batches now. */
  flushPending(): void {
    if (!this.joined) return;
    this.pushPending();
  }

  /** Foreground hook (RegistryClient.kick): suspension kills the socket
   * without running any failure path. A dead or unjoined session redials
   * NOW on fresh backoff; a joined one gets a deadline-checked probe. */
  kick(): void {
    if (this.closed) return;
    this.backoffMs = BACKOFF_BASE_MS;
    if (this.socket === undefined) {
      this.connect().catch(() => {});
      return;
    }
    if (!this.joined) {
      // A dial/handshake is already in flight — its hello deadline polices
      // it. Only a zombie socket with NO handshake pending is redialed.
      if (this.helloSentAt === undefined) this.connect().catch(() => {});
      return;
    }
    if (this.probeSentAt !== undefined || this.helloSentAt !== undefined)
      return;
    this.sendProbe();
  }

  // ── Connect ──────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.generation += 1;
    const gen = this.generation;
    this.joined = false;
    this.helloSentAt = undefined;
    this.probeSentAt = undefined;
    this.lastProtocolRx = this.deps.clock.now();

    const token = await this.deps.tokenSource.currentToken();
    if (gen !== this.generation || this.closed) return;
    if (token === undefined) {
      this.log('registry: no token; backing off');
      this.scheduleReconnect(gen);
      return;
    }
    const url = registryWsUrl(
      this.deps.cfg,
      this.deps.orgId,
      this.deps.deviceId,
    );
    this.log(`registry: dial ${redactUrl(url)}`);
    const socket = this.deps.wsFactory(url, {
      Authorization: `Bearer ${token}`,
    });
    this.socket = socket;
    this.lastInbound = this.deps.clock.now();
    this.lastProtocolRx = this.deps.clock.now();

    socket.onopen = () => {
      if (gen !== this.generation) return;
      // Hello with the persisted cursor (undefined asks for full state —
      // the wire doc wants explicit null). The deadline is armed BEFORE the
      // send: an unanswered hello must never hang the session.
      this.helloSentAt = this.deps.clock.now();
      const cursor = this.deps.delegate.helloCursor();
      this.sendFrame(
        encodeClientFrame({
          t: 'hello',
          cursor: cursor ?? null,
          device: this.deps.deviceId,
        }),
      );
    };
    socket.onmessage = m => {
      if (gen !== this.generation) return;
      if (typeof m.data === 'string') this.handleText(m.data, gen);
      // Binary frames don't exist on this room; ignore.
    };
    socket.onclose = () => this.onSocketError(gen);
    socket.onerror = () => this.onSocketError(gen);

    this.every(gen, PING_INTERVAL_MS, () => this.pingTick(gen));
    this.every(gen, PRESENCE_INTERVAL_MS, () => this.presenceTick(gen));
    this.every(gen, LIVENESS_TICK_MS, () => this.livenessTick(gen));
  }

  private onSocketError(gen: number): void {
    if (gen !== this.generation || this.closed || this.socket === undefined)
      return;
    this.log(
      `registry: session ended (joined=${this.joined}); redialing in ${this.backoffMs}ms`,
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
    // Stability-gated reset: only a session that survived ≥30s earns a
    // fresh 250ms; a connect-and-die session keeps growing the backoff.
    if (
      this.joinedAt !== undefined &&
      this.deps.clock.now() - this.joinedAt >= STABLE_RESET_MS
    ) {
      this.backoffMs = BACKOFF_BASE_MS;
    }
    this.joinedAt = undefined;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CAP_MS);
    const handle = this.deps.clock.setTimeout(() => {
      if (gen === this.generation && !this.closed)
        this.connect().catch(() => {});
    }, delay);
    this.timerHandles.push(handle);
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
    if (silence > SILENCE_LEASE_MS) {
      this.log('registry: socket silent past lease; treating as dead');
      this.onSocketError(gen);
      return;
    }
    this.socket.send('ping');
  }

  private presenceTick(gen: number): void {
    if (gen !== this.generation || !this.joined) return;
    this.sendFrame(
      encodeClientFrame({ t: 'presence', at: this.deps.clock.now() }),
    );
  }

  /** Hello answers and probes run against hard deadlines; a long-quiet but
   * joined room gets a probe. Any protocol frame clears both deadlines. */
  private livenessTick(gen: number): void {
    if (gen !== this.generation || this.socket === undefined || this.closed)
      return;
    const now = this.deps.clock.now();
    if (
      this.helloSentAt !== undefined &&
      now - this.helloSentAt > HELLO_DEADLINE_MS
    ) {
      this.log(
        'registry: no state frame within deadline; room presumed wedged, redialing',
      );
      this.onSocketError(gen);
      return;
    }
    if (
      this.probeSentAt !== undefined &&
      now - this.probeSentAt > PROBE_DEADLINE_MS
    ) {
      this.log('registry: probe unanswered past deadline; redialing');
      this.onSocketError(gen);
      return;
    }
    if (
      this.joined &&
      this.probeSentAt === undefined &&
      this.helloSentAt === undefined &&
      now - this.lastProtocolRx > PROBE_QUIET_MS
    ) {
      this.sendProbe();
      // Don't re-arm the quiet timer against the same silence.
      this.lastProtocolRx = now;
    }
  }

  private sendProbe(): void {
    this.probeSentAt = this.deps.clock.now();
    this.sendFrame(encodeClientFrame({ t: 'probe' }));
  }

  // ── Inbound ──────────────────────────────────────────────────────────

  private handleText(text: string, gen: number): void {
    this.lastInbound = this.deps.clock.now();
    if (text === 'pong') return; // transport lease refreshed; proves nothing
    let frame: ServerFrame | undefined;
    try {
      frame = JSON.parse(text) as ServerFrame;
    } catch {
      frame = undefined;
    }
    const t = (frame as { t?: unknown } | undefined)?.t;
    if (
      frame === undefined ||
      typeof t !== 'string' ||
      !['state', 'rows', 'ack', 'presence', 'probe-ok', 'error'].includes(t)
    ) {
      // Protocol breakdown — redial rather than run blind.
      this.log('registry: unparseable frame; redialing');
      this.onSocketError(gen);
      return;
    }
    this.lastProtocolRx = this.deps.clock.now();
    this.probeSentAt = undefined;

    switch (t) {
      case 'state': {
        const f = frame as Extract<ServerFrame, { t: 'state' }>;
        this.helloSentAt = undefined;
        const wasJoined = this.joined;
        this.joined = true;
        this.joinedAt = this.deps.clock.now();
        this.deps.delegate.onEvent({
          t: 'state',
          seq: f.seq,
          full: f.full,
          gcFloor: f.gcFloor ?? 0,
          rows: f.rows ?? [],
          presence: f.presence ?? {},
        });
        if (!wasJoined) {
          this.log(`registry: joined (seq=${f.seq}, full=${f.full})`);
          this.deps.delegate.onEvent({ t: 'connected' });
        }
        // Pending ops push now; our beat announces this device immediately.
        this.pushPending();
        this.sendFrame(
          encodeClientFrame({ t: 'presence', at: this.deps.clock.now() }),
        );
        break;
      }
      case 'rows': {
        const f = frame as Extract<ServerFrame, { t: 'rows' }>;
        this.deps.delegate.onEvent({
          t: 'rows',
          seq: f.seq,
          rows: f.rows ?? [],
        });
        break;
      }
      case 'ack': {
        const f = frame as Extract<ServerFrame, { t: 'ack' }>;
        this.deps.delegate.onEvent({
          t: 'ack',
          batch: f.batch,
          seq: f.seq,
          applied: f.applied ?? 0,
        });
        break;
      }
      case 'presence': {
        const f = frame as Extract<ServerFrame, { t: 'presence' }>;
        this.deps.delegate.onEvent({
          t: 'presence',
          device: f.device,
          at: f.at,
        });
        break;
      }
      case 'probe-ok':
        break; // liveness proven; clocks already advanced
      default: {
        const f = frame as { code?: string; message?: string };
        this.log(
          `registry: server rejected a frame: ${f.code ?? 'unknown'}: ${
            f.message ?? ''
          }`,
        );
      }
    }
  }

  // ── Outbound ─────────────────────────────────────────────────────────

  private pushPending(): void {
    for (const batch of this.deps.delegate.takePushable()) {
      this.sendFrame(
        encodeClientFrame({ t: 'push', batch: batch.batch, ops: batch.ops }),
      );
    }
  }

  private sendFrame(text: string): void {
    try {
      this.socket?.send(text);
    } catch {
      // send races teardown; the receive error drives the redial.
    }
  }

  // ── HTTP fallbacks (WorkspaceStore pull/push paths) ──────────────────

  /** GET /registry/{orgId}/rows?since= — the hello's delta answer over
   * plain HTTPS. */
  async pullDelta(): Promise<
    { seq: number; full: boolean; gcFloor: number; rows: Row[] } | undefined
  > {
    const url = registryRowsUrl(
      this.deps.cfg,
      this.deps.orgId,
      this.deps.deviceId,
      this.deps.delegate.helloCursor(),
    );
    try {
      const body = await edgeFetchJson<{
        seq: number;
        full?: boolean;
        gcFloor?: number;
        rows?: Row[];
      }>(url, this.deps.tokenSource, { method: 'GET' }, this.deps.fetchImpl);
      return {
        seq: body.seq,
        full: body.full ?? false,
        gcFloor: body.gcFloor ?? 0,
        rows: body.rows ?? [],
      };
    } catch {
      return undefined;
    }
  }

  /** POST /registry/{orgId}/push — op batches over plain HTTPS (LWW clocks
   * make replays apply zero ops). Retires acked batches via the delegate's
   * ack event so the cursor accounting stays in one place. */
  async pushPendingOverHTTP(): Promise<void> {
    for (const batch of this.deps.delegate.takePushable()) {
      const url = registryPushUrl(
        this.deps.cfg,
        this.deps.orgId,
        this.deps.deviceId,
      );
      try {
        const body = await edgeFetchJson<{ seq?: number; applied?: number }>(
          url,
          this.deps.tokenSource,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: batch.batch, ops: batch.ops }),
          },
          this.deps.fetchImpl,
        );
        this.deps.delegate.onEvent({
          t: 'ack',
          batch: batch.batch,
          seq: body.seq ?? 0,
          applied: body.applied ?? 0,
        });
      } catch {
        break; // transient — retry next cycle
      }
    }
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }
}
