// Ported from zeron@853872d edge/src/chat-frames.ts and
// apps/ios/Zeron/Sync/ChatFrames.swift (incl. ChatStateHeader + planCatchUp;
// the catch-up decision table comes from crates/sync/src/chat_client.rs
// plan_catch_up).
//
// chat2 wire frames: `[type u8][headerLen u32 LE][header JSON utf8][payload]`.
// Headers are tiny JSON; payloads are opaque byte blobs (Loro updates,
// checkpoint frontiers, presence ephemera) that only clients parse.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Frame type bytes. Client→server and server→client share one space. */
export const FRAME = {
  // client → server
  /** `{cursor, device}` — first frame on a socket; answered by `state`. */
  hello: 0x01,
  /** `{after, excludeOwn}` — request backfill rows with `seq > after`. */
  rowsReq: 0x03,
  /** `{batchId}` + payload = one opaque Loro update. */
  push: 0x06,
  /** `{at}` + opaque payload — relayed verbatim to live peers, never stored. */
  presence: 0x08,
  /** `{}` — liveness probe; answered by `probeOk` from the DO itself. */
  probe: 0x09,

  // server → client
  /** `{headSeq, seqFloor, checkpointSeq, checkpointSize, rowCount, rowBytes}`
   * + payload = checkpoint frontier bytes (empty when no checkpoint). */
  state: 0x02,
  /** `{seq, device, batchId}` + payload = update bytes. */
  row: 0x04,
  /** `{headSeq}` — backfill complete; subsequent `row` frames are live. */
  rowsDone: 0x05,
  /** `{batchId, seq, dup}` — push accepted (`dup` = batchId replay, no-op). */
  ack: 0x07,
  /** `{headSeq}` — probe answer. */
  probeOk: 0x0a,
  /** `{code, message}` — recoverable rejection (socket stays open). */
  error: 0x0b,
} as const;

export type FrameType = (typeof FRAME)[keyof typeof FRAME];

export interface Frame {
  type: number;
  header: Record<string, unknown>;
  payload: Uint8Array;
}

/** Headers are ids + a few integers; anything bigger is a client bug. */
export const MAX_HEADER_BYTES = 4096;

export const encodeFrame = (
  type: FrameType,
  header: Record<string, unknown>,
  payload?: Uint8Array,
): Uint8Array => {
  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadLen = payload?.length ?? 0;
  const out = new Uint8Array(5 + headerBytes.length + payloadLen);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, headerBytes.length, true);
  out.set(headerBytes, 5);
  if (payload) out.set(payload, 5 + headerBytes.length);
  return out;
};

/**
 * `undefined` = malformed. Unlike the DO, the CLIENT does not reject unknown
 * type bytes (ChatFrames.swift): it tolerates future server frame types —
 * callers skip unknown `type`s. Malformed lengths/JSON still decode to
 * undefined.
 */
export const decodeFrame = (bytes: Uint8Array): Frame | undefined => {
  if (bytes.length < 5) return undefined;
  const type = bytes[0];
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(
    1,
    true,
  );
  if (headerLen > MAX_HEADER_BYTES || 5 + headerLen > bytes.length)
    return undefined;
  let header: unknown;
  try {
    header = JSON.parse(decoder.decode(bytes.subarray(5, 5 + headerLen)));
  } catch {
    return undefined;
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header))
    return undefined;
  return {
    type,
    header: header as Record<string, unknown>,
    payload: bytes.subarray(5 + headerLen),
  };
};

// ── typed server headers (loose reads; absent = 0) ──────────────────────────

const u64 = (header: Record<string, unknown>, key: string): number => {
  const v = header[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** The hello answer: server log metadata only — the CLIENT plans catch-up. */
export interface ChatStateHeader {
  headSeq: number;
  seqFloor: number;
  checkpointSeq: number;
  checkpointSize: number;
  rowCount: number;
  rowBytes: number;
}

export const parseChatStateHeader = (
  header: Record<string, unknown>,
): ChatStateHeader | undefined => {
  if (typeof header.headSeq !== 'number') return undefined;
  return {
    headSeq: u64(header, 'headSeq'),
    seqFloor: u64(header, 'seqFloor'),
    checkpointSeq: u64(header, 'checkpointSeq'),
    checkpointSize: u64(header, 'checkpointSize'),
    rowCount: u64(header, 'rowCount'),
    rowBytes: u64(header, 'rowBytes'),
  };
};

// ── catch-up planning (pure — the client-side precision rule) ───────────────

export type ChatCatchUpPlan =
  | { kind: 'rowsOnly'; after: number }
  | { kind: 'checkpointThenRows'; after: number };

/**
 * Decide the catch-up path from the hello state (chat_client.rs
 * plan_catch_up, decision table pinned by its tests):
 * - cursor > headSeq means the server lost state — treat the cursor as fresh;
 * - checkpoint presence is the SIZE, not the seq (a freshly seeded room's
 *   checkpoint legitimately covers seq 0);
 * - a contained frontier skips rows the checkpoint already covers.
 */
export const planCatchUp = (
  cursor: number,
  state: ChatStateHeader,
  frontierContained: boolean,
): ChatCatchUpPlan => {
  const c = cursor > state.headSeq ? 0 : cursor;
  if (state.checkpointSize === 0) {
    return { kind: 'rowsOnly', after: c };
  }
  if (frontierContained) {
    return { kind: 'rowsOnly', after: Math.max(c, state.checkpointSeq) };
  }
  return { kind: 'checkpointThenRows', after: state.checkpointSeq };
};
