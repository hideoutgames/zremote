// Ported from zeron@853872d docs/registry-sync.md ("Wire protocol") and
// apps/ios/Zeron/Sync/RegistryClient.swift frame handling.
//
// JSON text frames on the registry room socket. Tolerant parsing: unknown
// frame types decode to undefined (the client skips them), never throw.

import type { Op, Row } from './registryCore';

// ── Client → server ─────────────────────────────────────────────────────────

export type ClientFrame =
  | { t: 'hello'; cursor: number | null; device: string }
  | { t: 'push'; batch: string; ops: Op[] }
  | { t: 'presence'; at: number }
  | { t: 'probe' };

export const encodeClientFrame = (frame: ClientFrame): string =>
  JSON.stringify(frame);

// ── Server → client ─────────────────────────────────────────────────────────

export type ServerFrame =
  | {
      t: 'state';
      seq: number;
      full: boolean;
      rows: Row[];
      gcFloor: number;
      presence?: Record<string, number>;
    }
  | { t: 'rows'; seq: number; rows: Row[] }
  | { t: 'ack'; batch: string; seq: number; applied?: number }
  | { t: 'presence'; device: string; at: number }
  | { t: 'probe-ok'; seq: number };

const KNOWN = new Set(['state', 'rows', 'ack', 'presence', 'probe-ok']);

/** Parse one server frame; undefined for malformed JSON or unknown `t`. */
export const parseServerFrame = (text: string): ServerFrame | undefined => {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj))
    return undefined;
  const t = (obj as { t?: unknown }).t;
  if (typeof t !== 'string' || !KNOWN.has(t)) return undefined;
  return obj as ServerFrame;
};
