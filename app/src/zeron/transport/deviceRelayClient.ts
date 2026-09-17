// Ported from zeron@853872d apps/ios/Zeron/Sync/DeviceRelayClient.swift.
//
// Device-room relay RPC client — dials a device's room on the edge as a
// `client` peer and speaks ControlRpc to the HOST engine over a virtual
// socket. Relay control frames (kind " relay" — leading space is the
// constant) signal host_offline/host_closed.

import {
  decodeFrame,
  encodeFrame,
  RPC_FRAME_HEADER,
  ECHO_FRAME_HEADER,
} from '../protocol/deviceFrames';
import { RpcDemux } from '../protocol/rpc';
import { newId } from '../doc/sessionDoc';
import { deviceWsUrl, redactUrl, type EdgeConfig } from './edge';
import type { Clock } from './clock';
import type { TokenSource } from './tokenSource';
import type { WsFactory, WsLike } from './ws';

// device_room.rs PING_INTERVAL / SILENCE_LEASE / ECHO_DEADLINE (ms).
export const PING_INTERVAL_MS = 10_000;
export const SILENCE_LEASE_MS = 25_000;
export const ECHO_DEADLINE_MS = 20_000;
const CALL_ATTEMPTS = 3;

export type RelayErrorKind = 'notConnected' | 'hostOffline' | 'rpc' | 'timeout';

export class RelayError extends Error {
  constructor(readonly kind: RelayErrorKind, message?: string) {
    super(
      message ??
        {
          notConnected: 'Not connected to the device',
          hostOffline: 'The device is offline',
          rpc: 'RPC failed',
          timeout: "The device didn't respond",
        }[kind],
    );
    this.name = 'RelayError';
  }
}

/** Registry-presence verdict gating peer dials: `dark` fails peer calls
 * fast with ZERO dials; every ambiguity stays `unknown` so a rows-down/
 * relay-up incident can never park the relay. */
export type PeerLiveness = 'live' | 'dark' | 'unknown';

export interface DeviceRelayClientDeps {
  cfg: EdgeConfig;
  deviceId: string;
  wsFactory: WsFactory;
  tokenSource: TokenSource;
  clock: Clock;
  /** Presence-based dial gate; undefined = never park (unknown). */
  liveness?: () => PeerLiveness;
  log?: (line: string) => void;
}

export interface RelayStream<T> {
  items: AsyncIterable<T>;
  cancel(): void;
}

export class DeviceRelayClient {
  private socket: WsLike | undefined;
  private nextId = 1;
  private readonly pending = new RpcDemux();
  private connected = false;
  /** Transport clock — any inbound (the DO's auto-pong included) counts. */
  private lastInbound: number;
  /** Host-proof clock — echo replies and inbound RPC frames only. */
  private lastHostProof: number;
  /** The host has echoed at least once on this link (feature detection:
   * old hosts keep transport-lease-only behavior). */
  private echoSeen = false;
  private closed = false;
  private connectPromise: Promise<void> | undefined;
  private timerHandles: unknown[] = [];
  /** Set while `pending.failAll` runs during a teardown so routed errors
   * keep the teardown's kind (retry policy distinguishes hostOffline). */
  private teardownKind: RelayErrorKind | undefined;
  /** Per-request error kind for fail paths that go through the demux as
   * plain strings (timeout / notConnected). */
  private errorKinds = new Map<number, RelayErrorKind>();

  constructor(private readonly deps: DeviceRelayClientDeps) {
    this.lastInbound = deps.clock.now();
    this.lastHostProof = deps.clock.now();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  private connect(): Promise<void> {
    if (this.connected && this.socket !== undefined) return Promise.resolve();
    if (this.connectPromise !== undefined) return this.connectPromise;
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.closed) throw new RelayError('notConnected');
    // Registry-dark dial parking: positive stale-presence evidence fails
    // fast with zero dials; unknown/ambiguous verdicts never park.
    if (this.deps.liveness?.() === 'dark') {
      throw new RelayError('hostOffline');
    }
    const token = await this.deps.tokenSource.currentToken();
    if (token === undefined) throw new RelayError('notConnected');
    // A reconnect is a new relay peer: fresh connId, else two tagged
    // sockets can briefly coexist in the hibernating DO.
    const url = deviceWsUrl(this.deps.cfg, this.deps.deviceId, newId());
    this.log(`relay ${this.deps.deviceId}: dial ${redactUrl(url)}`);
    const socket = this.deps.wsFactory(url, {
      Authorization: `Bearer ${token}`,
    });
    this.socket = socket;
    this.lastInbound = this.deps.clock.now();
    this.lastHostProof = this.deps.clock.now();
    this.echoSeen = false;

    // The link is usable only once the socket OPENs — sends during
    // CONNECTING throw on every real WebSocket stack. A dial that dies
    // before open rejects the connect promise (hostOffline → retried).
    await new Promise<void>((resolve, reject) => {
      socket.onmessage = m => this.handleInbound(m);
      socket.onclose = () => {
        const error = new RelayError('hostOffline');
        this.teardown(error);
        reject(error);
      };
      socket.onerror = () => {
        const error = new RelayError('hostOffline');
        this.teardown(error);
        reject(error);
      };
      socket.onopen = () => {
        // One echo immediately on connect: feature detection + instant
        // proof the edge↔host leg is real.
        this.sendEcho();
        resolve();
      };
    });
    this.connected = true;

    const keepalive = () => {
      this.keepaliveTick();
      this.timerHandles.push(
        this.deps.clock.setTimeout(keepalive, PING_INTERVAL_MS),
      );
    };
    this.timerHandles.push(
      this.deps.clock.setTimeout(keepalive, PING_INTERVAL_MS),
    );
  }

  close(): void {
    this.closed = true;
    this.teardown(new RelayError('notConnected'));
  }

  /** Reentrancy guard: socket.close() fires onclose synchronously, and a
   * nested teardown must not clobber the outer failure's kind. */
  private tearingDown = false;

  private teardown(error: RelayError): void {
    if (this.tearingDown) return;
    this.tearingDown = true;
    try {
      for (const h of this.timerHandles) this.deps.clock.clearTimeout(h);
      this.timerHandles = [];
      const socket = this.socket;
      this.socket = undefined;
      socket?.close(1000, 'goingAway');
      this.connected = false;
      this.teardownKind = error.kind;
      try {
        this.pending.failAll(error.message);
      } finally {
        this.teardownKind = undefined;
      }
    } finally {
      this.tearingDown = false;
    }
  }

  /** Keepalive + liveness in one 10s tick: judge the transport lease and
   * the host-echo deadline, then ride a text ping (DO lease) and an echo
   * frame (host proof) out together. */
  private keepaliveTick(): void {
    if (this.socket === undefined) return;
    const now = this.deps.clock.now();
    if (now - this.lastInbound > SILENCE_LEASE_MS) {
      this.log(
        `relay ${this.deps.deviceId}: socket silent past lease; dropping link`,
      );
      this.teardown(new RelayError('hostOffline'));
      return;
    }
    // Echo enforcement is feature-detected: only a host that has echoed at
    // least once on this link is held to the 20s deadline — this is what
    // kills zombie paths where the DO's auto-pong masks a dead host leg.
    if (this.echoSeen && now - this.lastHostProof > ECHO_DEADLINE_MS) {
      this.log(
        `relay ${this.deps.deviceId}: host echo silent; dropping zombie link`,
      );
      this.teardown(new RelayError('hostOffline'));
      return;
    }
    try {
      this.socket.send('ping');
    } catch {
      this.teardown(new RelayError('hostOffline'));
      return;
    }
    this.sendEcho();
  }

  private sendEcho(): void {
    if (this.socket === undefined) return;
    try {
      this.socket.send(encodeFrame(ECHO_FRAME_HEADER, new Uint8Array(0)));
    } catch {
      /* teardown driven by receive errors */
    }
  }

  // ── RPC ──────────────────────────────────────────────────────────────

  /**
   * One unary ControlRpc call. The default 10s deadline suits interactive
   * calls; attachment uploads pass longer ones. Retries (3 attempts) apply
   * ONLY to hostOffline/notConnected — rpc errors and timeouts are
   * caller-visible verdicts, not redial signals.
   */
  async call<T>(
    method: string,
    params: Record<string, unknown>,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    let last: RelayError = new RelayError('notConnected');
    for (let attempt = 0; attempt < CALL_ATTEMPTS; attempt++) {
      try {
        return await this.callOnce<T>(method, params, timeoutMs);
      } catch (error) {
        const e =
          error instanceof RelayError
            ? error
            : new RelayError('rpc', String(error));
        last = e;
        if (attempt >= CALL_ATTEMPTS - 1 || this.closed) throw e;
        if (e.kind === 'hostOffline' || e.kind === 'notConnected') {
          this.teardown(e);
          await this.sleep((attempt + 1) * 250);
        } else {
          throw e;
        }
      }
    }
    throw last;
  }

  private callOnce<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    return this.connect().then(() => {
      const id = this.nextId++;
      // Always send a params object — the engine's serde rejects a missing
      // field even when every param is optional.
      const payload = new TextEncoder().encode(
        JSON.stringify({ id, method, params }) + '\n',
      );
      const data = encodeFrame(RPC_FRAME_HEADER, payload);

      const result = new Promise<{
        ok?: unknown;
        err?: string;
        kind?: RelayErrorKind;
      }>(resolve => {
        // Install the waiter BEFORE sending: a fast host reply must not
        // reach the demux before registration.
        this.pending.register(id, {
          onOk: v => {
            this.errorKinds.delete(id);
            resolve({ ok: v });
          },
          onErr: e => {
            const kind = this.errorKinds.get(id) ?? this.teardownKind;
            this.errorKinds.delete(id);
            resolve({ err: e, kind });
          },
        });
        this.send(data, id);
        this.timerHandles.push(
          this.deps.clock.setTimeout(() => this.timeoutCall(id), timeoutMs),
        );
      });
      return result.then((r): T => {
        if ('err' in r && r.err !== undefined) {
          throw new RelayError(r.kind ?? 'rpc', r.err);
        }
        if (!('ok' in r)) throw new RelayError('rpc', 'unexpected reply');
        return r.ok as T;
      });
    });
  }

  private send(data: Uint8Array, id: number): void {
    if (this.socket === undefined) {
      this.errorKinds.set(id, 'notConnected');
      this.pending.fail(id, 'Not connected to the device');
      return;
    }
    try {
      this.socket.send(data);
    } catch {
      this.errorKinds.set(id, 'notConnected');
      this.pending.fail(id, 'Not connected to the device');
      this.teardown(new RelayError('notConnected'));
    }
  }

  private timeoutCall(id: number): void {
    if (!this.pending.owns(id)) return;
    this.errorKinds.set(id, 'timeout');
    this.pending.fail(id, "The device didn't respond");
    // A lost reply on a socket the DO keeps auto-ponging is a zombie path:
    // invalidate the link so the next call re-dials.
    this.log(
      `relay ${this.deps.deviceId}: call timed out; dropping link as suspect`,
    );
    this.teardown(new RelayError('notConnected'));
  }

  /**
   * A streaming ControlRpc call. Items remain registered until a terminal
   * done/err, socket close, or consumer cancellation (`cancel()` sends the
   * `{id, cancel:true}` frame).
   */
  async stream<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<RelayStream<T>> {
    if (this.closed) throw new RelayError('notConnected');
    await this.connect();
    const id = this.nextId++;
    const queue: T[] = [];
    let done: string | undefined;
    let doneKind: RelayErrorKind = 'rpc';
    let finished = false;
    let wake: (() => void) | undefined;
    const notify = () => {
      const w = wake;
      wake = undefined;
      w?.();
    };
    this.pending.register(id, {
      stream: true,
      onItem: item => {
        queue.push(item as T);
        notify();
      },
      onDone: error => {
        done = error;
        doneKind = this.teardownKind ?? 'rpc';
        finished = true;
        notify();
      },
    });
    const payload = new TextEncoder().encode(
      JSON.stringify({ id, method, params }) + '\n',
    );
    this.send(encodeFrame(RPC_FRAME_HEADER, payload), id);

    const cancel = () => {
      if (!this.pending.removeStreamForCancellation(id)) return;
      finished = true;
      notify();
      if (this.socket === undefined) return;
      const cancelPayload = new TextEncoder().encode(
        JSON.stringify({ id, cancel: true }) + '\n',
      );
      try {
        this.socket.send(encodeFrame(RPC_FRAME_HEADER, cancelPayload));
      } catch {
        this.teardown(new RelayError('notConnected'));
      }
    };

    const items: AsyncIterable<T> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            for (;;) {
              if (queue.length > 0)
                return { value: queue.shift() as T, done: false };
              if (finished) {
                if (done !== undefined) throw new RelayError(doneKind, done);
                return { value: undefined, done: true };
              }
              await new Promise<void>(resolve => {
                wake = resolve;
              });
            }
          },
          async return(): Promise<IteratorResult<T>> {
            cancel();
            return { value: undefined, done: true };
          },
        };
      },
    };
    return { items, cancel };
  }

  // ── Inbound ──────────────────────────────────────────────────────────

  private handleInbound(m: { data: string | Uint8Array }): void {
    this.lastInbound = this.deps.clock.now();
    if (typeof m.data === 'string') return; // "pong" — proves only OUR leg
    const decoded = decodeFrame(m.data);
    if (decoded === undefined) return;
    switch (decoded.header.k) {
      case 'rpc':
        // An inbound RPC frame comes from the host — proof enough.
        this.lastHostProof = this.deps.clock.now();
        this.echoSeen = true;
        this.pending.handleNdjson(new TextDecoder().decode(decoded.payload));
        break;
      case 'echo':
        // The HOST echoed our keepalive back — the end-to-end path
        // (client → edge → host → edge → client) is alive.
        this.lastHostProof = this.deps.clock.now();
        this.echoSeen = true;
        break;
      case ' relay':
        // {"error":"host_offline"|"host_closed"|…} — link down.
        this.teardown(new RelayError('hostOffline'));
        break;
      default:
        break;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.deps.clock.setTimeout(resolve, ms);
    });
  }

  private log(line: string): void {
    this.deps.log?.(line);
  }
}
