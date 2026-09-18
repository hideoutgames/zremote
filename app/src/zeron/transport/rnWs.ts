// React Native built-in WebSocket WsFactory — the Expo Go transport. RN's
// WebSocket supports `{headers}` as the third constructor argument and
// `binaryType='arraybuffer'`, which covers the relay/room needs (binary
// chat-room frames arrive as ArrayBuffer). Used only when
// `Constants.executionEnvironment === 'storeClient'` (ZeronApp); production
// keeps nitroWsFactory.

import type { WsFactory, WsLike, WsMessage } from './ws';

interface RnSocket {
  readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen?: () => void;
  onmessage?: (e: { data: string | ArrayBuffer }) => void;
  onclose?: (e: { code: number; reason?: string }) => void;
  onerror?: (e: { message?: string }) => void;
}

const STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;

export const rnWsFactory: WsFactory = (url, headers) => {
  const socket = new (WebSocket as unknown as new (
    url: string,
    protocols?: string | string[] | null,
    options?: { headers?: Record<string, string> },
  ) => RnSocket)(url, null, { headers }) as RnSocket;
  socket.binaryType = 'arraybuffer';
  const like: WsLike = {
    get readyState() {
      return STATES[socket.readyState] ?? 'CLOSED';
    },
    send: data =>
      socket.send(
        typeof data === 'string' ? data : (data.buffer as ArrayBuffer),
      ),
    close: (code, reason) => socket.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = () => like.onopen?.();
  socket.onmessage = e => {
    const msg: WsMessage =
      typeof e.data === 'string'
        ? { data: e.data }
        : { data: new Uint8Array(e.data), isBinary: true };
    like.onmessage?.(msg);
  };
  socket.onclose = e => like.onclose?.({ code: e.code, reason: e.reason });
  socket.onerror = e => like.onerror?.(e.message ?? 'socket error');
  return like;
};
