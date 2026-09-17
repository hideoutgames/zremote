// Ported from zeron@853872d — Node `ws`-backed WsFactory (Jest + any Node
// harness; the app uses nitroWs.ts).

import WebSocket from 'ws';
import type { WsFactory, WsLike, WsReadyState } from './ws';

const STATES: WsReadyState[] = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

export const nodeWsFactory: WsFactory = (url, headers) => {
  const socket = new WebSocket(url, { headers });
  const like: WsLike = {
    get readyState() {
      return STATES[socket.readyState] ?? 'CLOSED';
    },
    send: data => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.on('open', () => like.onopen?.());
  socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      const buf: Uint8Array = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data; // Buffer is already a Uint8Array
      like.onmessage?.({
        data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        isBinary: true,
      });
    } else {
      like.onmessage?.({ data: data.toString() });
    }
  });
  socket.on('close', (code: number, reason: Buffer) =>
    like.onclose?.({ code, reason: reason.toString() }),
  );
  socket.on('error', (err: Error) => like.onerror?.(err.message));
  return like;
};
