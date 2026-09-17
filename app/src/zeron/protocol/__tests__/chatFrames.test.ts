// Ported from zeron@853872d edge/src/chat-frames.test.ts and
// crates/sync/src/chat_client.rs plan_catch_up tests.
//
// Client-side codec: unlike the DO's decoder, unknown type bytes are
// TOLERATED (ChatFrames.swift) — the "rejects 0x7f" edge vector becomes a
// "decodes 0x7f" vector here; everything else is byte-for-byte identical.

import {
  decodeFrame,
  encodeFrame,
  FRAME,
  MAX_HEADER_BYTES,
  parseChatStateHeader,
  planCatchUp,
  type ChatStateHeader,
} from '../chatFrames';

const bytesOf = (len: number, seed: number): Uint8Array => {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (seed + i * 31) % 256;
  return out;
};

const state = (over: Partial<ChatStateHeader> = {}): ChatStateHeader => ({
  headSeq: 10,
  seqFloor: 0,
  checkpointSeq: 0,
  checkpointSize: 0,
  rowCount: 0,
  rowBytes: 0,
  ...over,
});

describe('chat2 frame codec', () => {
  it('pins the wire layout: [type u8][headerLen u32 LE][header][payload]', () => {
    const frame = encodeFrame(
      FRAME.push,
      { batchId: 'b1' },
      new Uint8Array([9, 8, 7]),
    );
    expect(frame[0]).toBe(FRAME.push);
    const headerJson = JSON.stringify({ batchId: 'b1' });
    expect(new DataView(frame.buffer).getUint32(1, true)).toBe(
      headerJson.length,
    );
    expect(
      new TextDecoder().decode(frame.subarray(5, 5 + headerJson.length)),
    ).toBe(headerJson);
    expect([...frame.subarray(5 + headerJson.length)]).toEqual([9, 8, 7]);
  });

  it('round-trips every frame type, with and without payload', () => {
    for (const type of Object.values(FRAME)) {
      const payload = bytesOf(1000, type);
      const decoded = decodeFrame(
        encodeFrame(type, { seq: 7, device: 'dev-a' }, payload),
      );
      expect(decoded).toBeDefined();
      expect(decoded!.type).toBe(type);
      expect(decoded!.header).toEqual({ seq: 7, device: 'dev-a' });
      expect(decoded!.payload).toEqual(payload);

      const bare = decodeFrame(encodeFrame(type, {}));
      expect(bare!.payload.length).toBe(0);
    }
  });

  it('round-trips a subarray view (offset ≠ 0 — the ws buffer case)', () => {
    const inner = encodeFrame(FRAME.row, { seq: 1 }, bytesOf(64, 3));
    const shifted = new Uint8Array(inner.length + 8);
    shifted.set(inner, 8);
    const decoded = decodeFrame(shifted.subarray(8));
    expect(decoded?.header).toEqual({ seq: 1 });
    expect(decoded?.payload).toEqual(bytesOf(64, 3));
  });

  it('rejects malformed frames as undefined, never throws', () => {
    expect(decodeFrame(new Uint8Array(0))).toBeUndefined();
    expect(decodeFrame(new Uint8Array([FRAME.hello]))).toBeUndefined(); // truncated length
    const truncated = encodeFrame(FRAME.hello, { cursor: 5 });
    new DataView(truncated.buffer).setUint32(1, 9999, true);
    expect(decodeFrame(truncated)).toBeUndefined();
    const junk = new Uint8Array([FRAME.hello, 2, 0, 0, 0, 0x7b, 0x7b]);
    expect(decodeFrame(junk)).toBeUndefined();
    const arr = new TextEncoder().encode('[1]');
    const arrFrame = new Uint8Array(5 + arr.length);
    arrFrame[0] = FRAME.hello;
    new DataView(arrFrame.buffer).setUint32(1, arr.length, true);
    arrFrame.set(arr, 5);
    expect(decodeFrame(arrFrame)).toBeUndefined();
  });

  it('tolerates unknown type bytes (client tolerance; DO rejects them)', () => {
    const decoded = decodeFrame(new Uint8Array([0x7f, 2, 0, 0, 0, 0x7b, 0x7d]));
    expect(decoded).toBeDefined();
    expect(decoded!.type).toBe(0x7f);
  });

  it('rejects oversized headers (payloads are unbounded here; the DO caps frames)', () => {
    const fat = encodeFrame(FRAME.hello, { pad: 'x'.repeat(MAX_HEADER_BYTES) });
    expect(decodeFrame(fat)).toBeUndefined();
  });
});

describe('planCatchUp (chat_client.rs decision table)', () => {
  it('cursor past headSeq = server lost state ⇒ treat as fresh', () => {
    const s = state({ headSeq: 5 });
    expect(planCatchUp(99, s, true)).toEqual({ kind: 'rowsOnly', after: 0 });
    expect(planCatchUp(6, s, true)).toEqual({ kind: 'rowsOnly', after: 0 });
  });

  it('no checkpoint (size 0) ⇒ rowsOnly from cursor', () => {
    const s = state({ headSeq: 10, checkpointSeq: 4, checkpointSize: 0 });
    expect(planCatchUp(3, s, false)).toEqual({ kind: 'rowsOnly', after: 3 });
    // checkpointSize is the presence signal — a seq-0 checkpoint still counts.
    expect(
      planCatchUp(3, state({ checkpointSeq: 0, checkpointSize: 12 }), true),
    ).toEqual({
      kind: 'rowsOnly',
      after: 3,
    });
  });

  it('contained checkpoint frontier ⇒ rowsOnly after max(cursor, checkpointSeq)', () => {
    const s = state({ headSeq: 20, checkpointSeq: 8, checkpointSize: 64 });
    expect(planCatchUp(3, s, true)).toEqual({ kind: 'rowsOnly', after: 8 });
    expect(planCatchUp(12, s, true)).toEqual({ kind: 'rowsOnly', after: 12 });
  });

  it('uncontained checkpoint frontier ⇒ checkpointThenRows', () => {
    const s = state({ headSeq: 20, checkpointSeq: 8, checkpointSize: 64 });
    expect(planCatchUp(3, s, false)).toEqual({
      kind: 'checkpointThenRows',
      after: 8,
    });
    expect(planCatchUp(0, s, false)).toEqual({
      kind: 'checkpointThenRows',
      after: 8,
    });
  });
});

describe('parseChatStateHeader', () => {
  it('reads the hello state header, absent numbers default to 0', () => {
    expect(
      parseChatStateHeader({
        headSeq: 7,
        checkpointSeq: 4,
        checkpointSize: 32,
      }),
    ).toEqual({
      headSeq: 7,
      seqFloor: 0,
      checkpointSeq: 4,
      checkpointSize: 32,
      rowCount: 0,
      rowBytes: 0,
    });
    expect(parseChatStateHeader({})).toBeUndefined();
  });
});
