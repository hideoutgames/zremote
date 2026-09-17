// Scripted WsLike fakes for the transport tests — records sent frames and
// lets the test inject inbound frames/close.

import type { FetchImpl, FetchResponse } from '../transport/edgeHttp';
import type { WsFactory, WsLike, WsReadyState } from '../transport/ws';

export class FakeWs implements WsLike {
  readyState: WsReadyState = 'CONNECTING';
  sent: (string | Uint8Array)[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage:
    | ((m: { data: string } | { data: Uint8Array; isBinary: true }) => void)
    | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((err: string) => void) | null = null;

  constructor(readonly url: string, readonly headers: Record<string, string>) {}

  send(data: string | Uint8Array): void {
    if (this.readyState !== 'OPEN') throw new Error('send on non-open socket');
    this.sent.push(data);
  }

  private closeFired = false;

  close(code = 1000, reason = ''): void {
    this.closed = true;
    this.readyState = 'CLOSED';
    if (this.closeFired) return;
    this.closeFired = true;
    this.onclose?.({ code, reason });
  }

  // ── test-side driving ────────────────────────────────────────────────

  open(): void {
    this.readyState = 'OPEN';
    this.onopen?.();
  }

  receive(data: string | Uint8Array): void {
    this.onmessage?.(
      typeof data === 'string' ? { data } : { data, isBinary: true },
    );
  }

  /** Abrupt server-side drop (no close handshake semantics needed here). */
  drop(code = 1006, reason = 'abnormal'): void {
    this.readyState = 'CLOSED';
    this.close(code, reason);
  }
}

export class FakeWsHub {
  sockets: FakeWs[] = [];
  readonly factory: WsFactory = (url, headers) => {
    const ws = new FakeWs(url, headers);
    this.sockets.push(ws);
    return ws;
  };

  get latest(): FakeWs {
    const s = this.sockets[this.sockets.length - 1];
    if (s === undefined) throw new Error('no socket dialed');
    return s;
  }
}

/** Fetch stub: scripts (url → response) in order of registration. */
export const fakeFetch = (
  handler: (
    url: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    },
  ) => Partial<FetchResponse> | Promise<Partial<FetchResponse>> | Error,
): {
  fetchImpl: FetchImpl;
  calls: {
    url: string;
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    };
  }[];
} => {
  const calls: {
    url: string;
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    };
  }[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    const out = await handler(url, init);
    if (out instanceof Error) throw out;
    return {
      status: out.status ?? 200,
      headers: out.headers ?? { get: () => null },
      arrayBuffer: out.arrayBuffer ?? (async () => new ArrayBuffer(0)),
      text: out.text ?? (async () => '{}'),
    };
  };
  return { fetchImpl, calls };
};
