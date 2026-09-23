// Terminal client — OpenTerminal/SubscribeTerminal/WriteTerminal/
// ResizeTerminal/CloseTerminal over the chat's host relay.
// Params: rpc.rs L294-332 (`{chatId, cols, rows}`, `{terminalId, afterSeq?}`,
// `{terminalId, data}` base64, `{terminalId, cols, rows}`, `{terminalId}`).
// Subscribe replays a bounded 1MB window from `afterSeq` then tails
// (terminals.rs L296-322); Exit ends the stream. Exited shells' replay
// buffers live for a 30-min TTL (terminals.rs L37).

import { METHODS } from '../protocol/rpc';
import type { RelayLike } from '../attachments/upload';
import type { TerminalEvent, TerminalSession } from '../protocol/types';
import { base64Encode } from './ansi';

export interface Clock {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const realClock: Clock = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 12ms keyboard coalescer (desktop: crates/ui/src/terminal/view.rs L33). */
export class InputCoalescer {
  private buf: number[] = [];
  private timer: unknown;
  constructor(
    private readonly flush: (bytes: Uint8Array) => void,
    private readonly clock: Clock = realClock,
    private readonly windowMs = 12,
  ) {}
  push(bytes: Uint8Array): void {
    this.buf.push(...bytes);
    if (this.timer === undefined) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined;
        if (this.buf.length > 0) {
          const out = Uint8Array.from(this.buf);
          this.buf = [];
          this.flush(out);
        }
      }, this.windowMs);
    }
  }
  dispose(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** 80ms resize debounce (desktop: panel.rs L889-923). */
export class ResizeDebouncer {
  private timer: unknown;
  private last?: { cols: number; rows: number };
  constructor(
    private readonly send: (cols: number, rows: number) => void,
    private readonly clock: Clock = realClock,
    private readonly delayMs = 80,
  ) {}
  push(cols: number, rows: number): void {
    if (
      this.last !== undefined &&
      this.last.cols === cols &&
      this.last.rows === rows
    )
      return;
    this.last = { cols, rows };
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      this.send(cols, rows);
    }, this.delayMs);
  }
  dispose(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export interface TerminalHandle {
  session: TerminalSession;
  /** Latest data seq seen — the resume point for the next subscribe. */
  lastSeq: number;
  exited: boolean;
  exitCode?: number;
}

/** One shell tab: open → subscribe (replaying from lastSeq on reconnect) →
 * write/resize → close. Detaching cancels the stream but leaves the PTY
 * running on the host. */
export class TerminalClient {
  readonly handle: TerminalHandle;
  private coalescer: InputCoalescer;
  private resizer: ResizeDebouncer;
  private streamCancel?: () => void;
  /** Bumped by subscribe() and detach(): a stream resolving after either
   * is stale (superseded resubscribe or a detach during connect) and is
   * cancelled instead of tailing into a dead/unmounted consumer. */
  private subscribeGen = 0;

  constructor(
    private readonly relay: RelayLike,
    session: TerminalSession,
    private onEvent: (e: TerminalEvent) => void,
    clock: Clock = realClock,
  ) {
    this.handle = { session, lastSeq: 0, exited: false };
    this.coalescer = new InputCoalescer(bytes => {
      this.relay
        .call(METHODS.WRITE_TERMINAL, {
          terminalId: session.id,
          data: base64Encode(bytes),
        })
        .catch(() => {});
    }, clock);
    this.resizer = new ResizeDebouncer((cols, rows) => {
      this.relay
        .call(METHODS.RESIZE_TERMINAL, {
          terminalId: session.id,
          cols,
          rows,
        })
        .catch(() => {});
    }, clock);
  }

  /** Replay from lastSeq then tail; exits mark the handle. */
  async subscribe(): Promise<void> {
    if (this.relay.stream === undefined)
      throw new Error('relay does not support streams');
    const gen = ++this.subscribeGen;
    const stream = await this.relay.stream<TerminalEvent>(
      METHODS.SUBSCRIBE_TERMINAL,
      {
        terminalId: this.handle.session.id,
        afterSeq: this.handle.lastSeq,
      },
    );
    if (gen !== this.subscribeGen) {
      stream.cancel();
      return;
    }
    this.streamCancel = stream.cancel;
    for await (const e of stream.items) {
      this.handle.lastSeq = Math.max(this.handle.lastSeq, e.seq);
      if (e.type === 'exit') {
        this.handle.exited = true;
        this.handle.exitCode = e.exitCode;
      }
      this.onEvent(e);
      if (e.type === 'exit') break;
    }
  }

  /** Keyboard/shortcut bytes — coalesced 12ms. */
  input(bytes: Uint8Array): void {
    if (this.handle.exited) return;
    this.coalescer.push(bytes);
  }

  resize(cols: number, rows: number): void {
    if (this.handle.exited) return;
    this.resizer.push(cols, rows);
  }

  /** Rebind the event sink — a restored tab's old closure points at the
   * previous sheet mount's dead state setters. */
  setOnEvent(cb: (e: TerminalEvent) => void): void {
    this.onEvent = cb;
  }

  /** Detach: cancel the stream; the PTY keeps running on the host. */
  detach(): void {
    this.subscribeGen += 1;
    this.streamCancel?.();
    this.streamCancel = undefined;
  }

  /** Close the shell (explicit action only — confirmed by the caller). */
  async close(): Promise<void> {
    this.detach();
    this.coalescer.dispose();
    this.resizer.dispose();
    await this.relay.call(METHODS.CLOSE_TERMINAL, {
      terminalId: this.handle.session.id,
    });
    this.handle.exited = true;
  }
}

export const openTerminal = (
  relay: RelayLike,
  chatId: string,
  cols: number,
  rows: number,
): Promise<TerminalSession> =>
  relay.call(METHODS.OPEN_TERMINAL, { chatId, cols, rows });
