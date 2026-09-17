// Ported from zeron@853872d apps/ios/Zeron/Sync/DeviceRelayClient.swift
// (encodeFrame/decodeFrame), cross-checked against edge/src/device-room.ts
// (encodeDeviceFrame/decodeDeviceFrame) and crates/rpc/src/device_room.rs
// (encode_device_frame/decode_device_frame).
//
// Device-room relay frame codec (binary WS messages):
//   uleb128(headerLen) ‖ headerJSON ‖ payload.
// Header: { s: streamId, k: kind, to?: connId, from?: connId } — key order
// MUST be {"s","k","to","from"} for byte parity with both implementations;
// clients never set `to`/`from` (the DO stamps `from`). RPC payloads are
// ndjson ControlRpc frames.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Stream kinds. Relay control frames use kind " relay" — the leading space
 * is part of the constant (byte parity with the DO). */
export const RPC_KIND = 'rpc';
export const RELAY_KIND = ' relay';
export const ECHO_KIND = 'echo';

/// Timing constants (device_room.rs PING_INTERVAL / SILENCE_LEASE /
/// ECHO_DEADLINE), in milliseconds.
export const PING_INTERVAL_MS = 10_000;
export const SILENCE_LEASE_MS = 25_000;
export const ECHO_DEADLINE_MS = 20_000;

/** The only two client-emitted frames — literal strings, fixed key order. */
export const RPC_FRAME_HEADER = '{"s":"rpc","k":"rpc"}';
export const ECHO_FRAME_HEADER = '{"s":"echo","k":"echo"}';

export interface DeviceFrameHeader {
  /** Stream id, unique per (connId, logical stream). */
  s?: string;
  /** Stream kind: "rpc" | "term" | " relay" | "echo" | … — opaque to the relay. */
  k?: string;
  /** Routing: host→client target. */
  to?: string;
  /** Routing: client→host origin (stamped by the relay). */
  from?: string;
}

/** Build a header JSON string with the canonical key order {s,k,to,from}. */
export const encodeFrameHeader = (header: DeviceFrameHeader): string => {
  const ordered: Record<string, string> = {};
  if (header.s !== undefined) ordered.s = header.s;
  if (header.k !== undefined) ordered.k = header.k;
  if (header.to !== undefined) ordered.to = header.to;
  if (header.from !== undefined) ordered.from = header.from;
  return JSON.stringify(ordered);
};

/** `header` is the header JSON STRING (clients pass RPC_FRAME_HEADER /
 * ECHO_FRAME_HEADER); use encodeFrameHeader for arbitrary headers. */
export const encodeFrame = (
  header: string,
  payload: Uint8Array,
): Uint8Array => {
  const headerBytes = encoder.encode(header);
  const out = new Uint8Array(5 + headerBytes.length + payload.length);
  let len = headerBytes.length;
  let offset = 0;
  do {
    let byte = len % 128;
    len = Math.floor(len / 128);
    if (len !== 0) byte += 128;
    out[offset++] = byte;
  } while (len !== 0);
  out.set(headerBytes, offset);
  out.set(payload, offset + headerBytes.length);
  return out.subarray(0, offset + headerBytes.length + payload.length);
};

export interface DecodedDeviceFrame {
  header: DeviceFrameHeader;
  payload: Uint8Array;
}

/** `undefined` = malformed (truncated uleb128/header, bad JSON). Mirrors the
 * Swift decoder: unknown header keys are tolerated by the loose parse. */
export const decodeFrame = (
  data: Uint8Array,
): DecodedDeviceFrame | undefined => {
  let offset = 0;
  let length = 0;
  let shift = 0;
  while (offset < data.length) {
    const byte = data[offset];
    offset += 1;
    length += (byte % 128) * 2 ** shift;
    if (byte < 128) break;
    shift += 7;
    if (shift > 28) return undefined;
  }
  if (offset === 0 || offset + length > data.length) return undefined;
  if (offset > 0 && data[offset - 1] >= 128) return undefined; // unterminated uleb
  let header: unknown;
  try {
    header = JSON.parse(decoder.decode(data.subarray(offset, offset + length)));
  } catch {
    return undefined;
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header))
    return undefined;
  return {
    header: header as DeviceFrameHeader,
    payload: data.subarray(offset + length),
  };
};

/** Extract the error code from a relay control payload (`{"error": code}`). */
export const relayErrorCode = (payload: Uint8Array): string | undefined => {
  try {
    const obj = JSON.parse(decoder.decode(payload));
    return typeof obj?.error === 'string' ? obj.error : undefined;
  } catch {
    return undefined;
  }
};
