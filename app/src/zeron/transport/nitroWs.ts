// Ported from zeron@853872d — react-native-nitro-websockets WsFactory for
// iOS. Never imported by tests (the package is native-only).

import type { WsFactory, WsLike, WsMessage, WsReadyState } from './ws';

interface NitroMessage {
  data: string;
  isBinary: boolean;
  binaryData?: ArrayBuffer;
}

interface NitroSocket {
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen?: () => void;
  onmessage?: (m: NitroMessage) => void;
  onclose?: (e: { code: number; reason: string }) => void;
  onerror?: (e: { message?: string }) => void;
}

const STATES: WsReadyState[] = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

export const nitroWsFactory: WsFactory = (url, headers) => {
  const { NitroWebSocket } = require('react-native-nitro-websockets') as {
    NitroWebSocket: new (
      url: string,
      protocols?: string[],
      headers?: Record<string, string>,
    ) => NitroSocket;
  };
  const socket = new NitroWebSocket(url, undefined, headers);
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
  socket.onmessage = (m: NitroMessage) => {
    const msg: WsMessage = m.isBinary
      ? {
          data: new Uint8Array(m.binaryData ?? new ArrayBuffer(0)),
          isBinary: true,
        }
      : { data: m.data };
    like.onmessage?.(msg);
  };
  socket.onclose = e => like.onclose?.({ code: e.code, reason: e.reason });
  socket.onerror = e => like.onerror?.(e.message ?? 'socket error');
  return like;
};
