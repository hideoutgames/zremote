// Ported from zeron@853872d apps/ios/Zeron/Models/Entities.swift (derived
// display logic; itself a port of crates/proto/src/entities.rs and
// crates/ui/src/state.rs).

import type {
  Chat,
  ChatConfig,
  DeviceRow,
  SessionRow,
  SessionStatus,
  Space,
} from './types';

/** proto/src/lib.rs version_triple: parse a leading major.minor.patch,
 * tolerating a -suffix or +build on the patch. Anything else is undefined —
 * version gates treat that as "too old". */
export const versionTriple = (
  raw: string,
): [number, number, number] | undefined => {
  // Rust: splitn(3, '.') — the patch segment is everything after the second
  // dot, then split on '-'/'+' and parse the first segment.
  const trimmed = raw.trim();
  const d1 = trimmed.indexOf('.');
  if (d1 < 0) return undefined;
  const d2 = trimmed.indexOf('.', d1 + 1);
  if (d2 < 0) return undefined;
  const parsePart = (s: string): number | undefined =>
    /^\d+$/.test(s) ? Number(s) : undefined;
  const major = parsePart(trimmed.slice(0, d1));
  const minor = parsePart(trimmed.slice(d1 + 1, d2));
  const patchSeg = trimmed.slice(d2 + 1).split(/[-+]/)[0];
  const patch = parsePart(patchSeg);
  if (major === undefined || minor === undefined || patch === undefined)
    return undefined;
  return [major, minor, patch];
};

/** A Working/AwaitingInput row older than this reads as stale. */
export const SESSION_STALE_MS = 45_000;
/** Presence freshness window for device online dots. */
export const PRESENCE_FRESH_MS = 45_000;

export const effectiveStatus = (
  row: SessionRow | undefined,
  now: number,
): SessionStatus | undefined => {
  if (!row) return undefined;
  switch (row.status) {
    case 'working':
    case 'awaitingInput': {
      const age = now - row.updatedAt;
      // Negative ages (clock skew) are fresh.
      return age > SESSION_STALE_MS ? undefined : row.status;
    }
    case 'errored':
    case 'idle':
      return row.status;
  }
};

/** Display status for a chat row: the four user-facing states plus Errored.
 * Order doubles as urgency rank (lower = more urgent). */
export type ChatIndicator =
  | 'awaitingInput'
  | 'errored'
  | 'working'
  | 'completed'
  | 'idle';
export const CHAT_INDICATOR_ORDER: readonly ChatIndicator[] = [
  'awaitingInput',
  'errored',
  'working',
  'completed',
  'idle',
];

/** entities.rs chat_indicator — live Working/AwaitingInput win; Errored only
 * if unseen; else unseen ⇒ Completed; else Idle. */
export const chatIndicator = (
  chat: Chat,
  live: SessionStatus | undefined,
): ChatIndicator => {
  switch (live) {
    case 'working':
      return 'working';
    case 'awaitingInput':
      return 'awaitingInput';
    case 'errored':
      return chatUnseen(chat) ? 'errored' : 'idle';
    default:
      return chatUnseen(chat) ? 'completed' : 'idle';
  }
};

/** The Sessions list order: PURE RECENCY, id tiebreak (state.rs sort_active). */
export const sortActive = (chats: readonly Chat[]): Chat[] =>
  [...chats].sort((a, b) => {
    const ta = a.lastMessageAt ?? a.createdAt;
    const tb = b.lastMessageAt ?? b.createdAt;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

/** entities.rs: unseen when a message arrived after the last seen mark. */
export const chatUnseen = (chat: Chat): boolean => {
  if (chat.lastMessageAt === undefined) return false;
  if (chat.lastSeenAt === undefined) return true;
  return chat.lastMessageAt > chat.lastSeenAt;
};

export const displayTitle = (chat: Chat): string =>
  chat.title !== undefined && chat.title.length > 0
    ? chat.title
    : 'New session';

/** Space display name: explicit name, else the folder's basename (both
 * separators trimmed — proto display_name). */
export const spaceDisplayName = (space: Space): string => {
  if (space.name !== undefined && space.name.trim().length > 0)
    return space.name;
  const trimmed = space.path.replace(/[/\\]+$/, '');
  const base = trimmed.split(/[/\\]/).pop();
  return base !== undefined && base.length > 0 ? base : space.path;
};

export const deviceSupports = (
  device: DeviceRow | undefined,
  capability: string,
): boolean => device?.capabilities.includes(capability) ?? false;

/** Unknown device or an unparsable/unstamped version reads as "too old". */
export const deviceVersionAtLeast = (
  device: DeviceRow | undefined,
  min: [number, number, number],
): boolean => {
  if (!device?.version) return false;
  const v = versionTriple(device.version);
  if (!v) return false;
  return (
    v[0] > min[0] ||
    (v[0] === min[0] && (v[1] > min[1] || (v[1] === min[1] && v[2] >= min[2])))
  );
};

/** First host version honoring `RunRequest.worktree` (WorktreeSpec added in
 * 0a80fc15 / PR #216; first tagged release containing it: v0.2.62 — v0.2.61
 * does not include it). See docs/COMPATIBILITY.md "Capability gates". */
export const MIN_VERSION_RUN_WORKTREE: [number, number, number] = [0, 2, 62];

/** The wire `config` field decodes to ChatConfig with these defaults
 * (WorkspaceStore.project). */
export const parseChatConfig = (raw: unknown): ChatConfig | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return undefined;
  const c = raw as Record<string, unknown>;
  return {
    harness: typeof c.harness === 'string' ? c.harness : 'claude-code',
    model: typeof c.model === 'string' ? c.model : undefined,
    reasoning: typeof c.reasoning === 'string' ? c.reasoning : undefined,
    modelOptions:
      typeof c.modelOptions === 'object' &&
      c.modelOptions !== null &&
      !Array.isArray(c.modelOptions)
        ? (c.modelOptions as Record<string, unknown>)
        : {},
    sandbox: typeof c.sandbox === 'string' ? c.sandbox : undefined,
  };
};
