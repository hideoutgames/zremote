// Keep Zustand identities stable across session projections so React.memo
// rows (bubbles, composer chrome) skip when only the live tail changed.

import type { SessionDocMeta, SessionDocProjection } from '../doc/sessionDoc';
import type {
  MessageEntry,
  MessagePart,
  QueuedMessage,
  SessionCommandEntry,
} from '../protocol/types';

export const sameMeta = (a: SessionDocMeta, b: SessionDocMeta): boolean =>
  a.chatId === b.chatId &&
  a.schemaVersion === b.schemaVersion &&
  a.contextUsage?.tokens === b.contextUsage?.tokens &&
  a.contextUsage?.window === b.contextUsage?.window;

export const reuseMeta = (
  prev: SessionDocMeta,
  next: SessionDocMeta,
): SessionDocMeta => (sameMeta(prev, next) ? prev : next);

const samePart = (a: MessagePart, b: MessagePart): boolean => {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  switch (a.kind) {
    case 'text':
    case 'reasoning':
      return b.kind === a.kind && a.text === b.text;
    case 'error':
      return b.kind === 'error' && a.message === b.message;
    case 'image':
      return (
        b.kind === 'image' &&
        a.path === b.path &&
        a.name === b.name &&
        a.mimeType === b.mimeType
      );
    case 'input':
      return (
        b.kind === 'input' &&
        a.requestId === b.requestId &&
        a.resolved === b.resolved &&
        a.questions === b.questions
      );
    case 'tool':
      return b.kind === 'tool' && JSON.stringify(a) === JSON.stringify(b);
    default:
      return false;
  }
};

export const sameEntry = (a: MessageEntry, b: MessageEntry): boolean =>
  a.id === b.id &&
  a.role === b.role &&
  a.createdAt === b.createdAt &&
  a.deviceId === b.deviceId &&
  a.status === b.status &&
  a.continuationOf === b.continuationOf &&
  a.parts.length === b.parts.length &&
  a.parts.every((p, i) => samePart(p, b.parts[i]));

export const sameCommand = (
  a: SessionCommandEntry,
  b: SessionCommandEntry,
): boolean =>
  a.id === b.id &&
  a.status === b.status &&
  a.kind === b.kind &&
  a.issuedAt === b.issuedAt &&
  a.issuedBy === b.issuedBy &&
  a.expiresAt === b.expiresAt &&
  a.resolution === b.resolution &&
  a.basedOn?.turnId === b.basedOn?.turnId &&
  a.basedOn?.frontier === b.basedOn?.frontier &&
  JSON.stringify(a.payload) === JSON.stringify(b.payload);

export const sameQueued = (a: QueuedMessage, b: QueuedMessage): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const reuseById = <T extends { id: string }>(
  prev: readonly T[],
  next: readonly T[],
  eq: (a: T, b: T) => boolean,
): T[] => {
  if (prev.length === next.length && prev.every((p, i) => eq(p, next[i])))
    return prev as T[];
  const prevById = new Map(prev.map(p => [p.id, p]));
  return next.map(n => {
    const p = prevById.get(n.id);
    return p !== undefined && eq(p, n) ? p : n;
  });
};

/** Clone so in-place transcript mutations cannot hide behind a stable ref. */
export const cloneEntry = (entry: MessageEntry): MessageEntry => ({
  ...entry,
  parts: entry.parts.map(p => ({ ...p })),
});

export const shareSessionProjection = (
  prev: Pick<SessionDocProjection, 'entries' | 'commands' | 'queue' | 'meta'>,
  next: SessionDocProjection,
): SessionDocProjection => ({
  entries: reuseById(prev.entries, next.entries, sameEntry),
  commands: reuseById(prev.commands, next.commands, sameCommand),
  queue: reuseById(prev.queue, next.queue, sameQueued),
  meta: reuseMeta(prev.meta, next.meta),
});
