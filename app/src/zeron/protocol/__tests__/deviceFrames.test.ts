// Ported from zeron@853872d edge/src/device-frame.test.ts and
// apps/ios/ZeronTests/DeviceRelayClientTests.swift (uleb128 + canonical
// client header strings).

import {
  decodeFrame,
  ECHO_FRAME_HEADER,
  encodeFrame,
  encodeFrameHeader,
  relayErrorCode,
  RPC_FRAME_HEADER,
  RELAY_KIND,
} from '../deviceFrames';

describe('device frame codec', () => {
  it('round-trips header + payload', () => {
    const payload = new Uint8Array([1, 2, 3, 250, 255]);
    const frame = encodeFrame(
      encodeFrameHeader({ s: 'term-42', k: 'term', to: 'conn-9' }),
      payload,
    );
    const decoded = decodeFrame(frame);
    expect(decoded?.header).toEqual({ s: 'term-42', k: 'term', to: 'conn-9' });
    expect([...decoded!.payload]).toEqual([...payload]);
  });

  it('handles empty payloads and long headers', () => {
    const header = { s: 'x'.repeat(200), k: 'rpc', from: 'conn-1' };
    const decoded = decodeFrame(
      encodeFrame(encodeFrameHeader(header), new Uint8Array()),
    );
    expect(decoded?.header).toEqual(header);
    expect(decoded?.payload.length).toBe(0);
  });

  it('emits the canonical client header strings byte-for-byte', () => {
    // Swift emits these literals; key order is part of the wire contract.
    expect(RPC_FRAME_HEADER).toBe('{"s":"rpc","k":"rpc"}');
    expect(ECHO_FRAME_HEADER).toBe('{"s":"echo","k":"echo"}');
    const frame = encodeFrame(RPC_FRAME_HEADER, new Uint8Array([0x7b]));
    // uleb128 headerLen = 21, single byte (no continuation bit).
    expect(frame[0]).toBe(21);
    expect(new TextDecoder().decode(frame.subarray(1, 22))).toBe(
      RPC_FRAME_HEADER,
    );
    expect(frame[22]).toBe(0x7b);
  });

  it('encodes multi-byte uleb128 lengths', () => {
    const header = `{"s":"${'x'.repeat(300)}"}`; // length > 127 ⇒ two uleb bytes
    const frame = encodeFrame(header, new Uint8Array());
    const decoded = decodeFrame(frame);
    expect(decoded?.header.s).toBe('x'.repeat(300));
    // header length 306 → uleb 0xB2 0x02
    expect(frame[0] >= 128).toBe(true);
    expect(frame[1] < 128).toBe(true);
  });

  it('rejects malformed frames as undefined', () => {
    expect(decodeFrame(new Uint8Array(0))).toBeUndefined();
    expect(decodeFrame(new Uint8Array([0x80]))).toBeUndefined(); // unterminated uleb
    expect(decodeFrame(new Uint8Array([10, 0x7b, 0x7b]))).toBeUndefined(); // header past end
    expect(decodeFrame(new Uint8Array([2, 0x7b, 0x7b]))).toBeUndefined(); // junk JSON
    const arr = new TextEncoder().encode('[1]');
    expect(decodeFrame(new Uint8Array([arr.length, ...arr]))).toBeUndefined();
  });

  it('relayErrorCode parses relay control payloads', () => {
    expect(RELAY_KIND).toBe(' relay'); // leading space is part of the constant
    expect(
      relayErrorCode(new TextEncoder().encode('{"error":"no-device"}')),
    ).toBe('no-device');
    expect(relayErrorCode(new TextEncoder().encode('{}'))).toBeUndefined();
    expect(
      relayErrorCode(new TextEncoder().encode('not json')),
    ).toBeUndefined();
  });
});
