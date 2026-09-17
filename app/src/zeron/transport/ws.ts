// Ported from zeron@853872d — socket abstraction for the edge transports
// (docs/ARCHITECTURE.md "Transports"): the minimal WebSocket surface the
// room/relay clients need, so Jest can script fakes and iOS can bind the
// Nitro socket.

export type WsMessage = { data: string } | { data: Uint8Array; isBinary: true };

export type WsReadyState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';

export interface WsLike {
  readonly readyState: WsReadyState;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((m: WsMessage) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((err: string) => void) | null;
}

/** `headers` carry `Authorization: Bearer …` — never the URL. */
export type WsFactory = (
  url: string,
  headers: Record<string, string>,
) => WsLike;
