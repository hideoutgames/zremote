// Sidecar backup for message-queue rows added while the host is offline.
// Online queue writes live in the Loro doc / WatchQueue — we do not copy
// those here. Persist is immediate (no debounce) so a kill after send
// cannot drop the backup.

import { useMemo } from 'react';
import { createStore, useStore } from 'zustand';
import type { DocDisk } from '../native/docDisk';
import type { QueuedMessage } from '../protocol/types';

export type LocalQueuedMessage = Pick<
  QueuedMessage,
  'id' | 'text' | 'attachments' | 'holdForTurnEnd' | 'issuedBy' | 'issuedAt'
>;

export interface QueuedLocalState {
  byChat: Record<string, LocalQueuedMessage[]>;
}

export const queuedLocalStore = createStore<QueuedLocalState>(() => ({
  byChat: {},
}));

interface QueuedLocalPersist {
  disk: DocDisk;
  orgId: string;
  userId: string;
}

let persist: QueuedLocalPersist | undefined;

const persistNow = (): Promise<void> => {
  if (persist === undefined) return Promise.resolve();
  const { disk, orgId, userId } = persist;
  return disk.saveQueuedLocal(
    orgId,
    userId,
    queuedLocalStore.getState().byChat,
  );
};

const isLocalQueuedRow = (v: unknown): v is LocalQueuedMessage => {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    typeof o.issuedBy === 'string' &&
    typeof o.issuedAt === 'number'
  );
};

const parseSaved = (
  saved: Record<string, unknown> | undefined,
): Record<string, LocalQueuedMessage[]> => {
  if (saved === undefined) return {};
  const byChat: Record<string, LocalQueuedMessage[]> = {};
  for (const [chatId, rows] of Object.entries(saved)) {
    if (!Array.isArray(rows)) continue;
    const next = rows.filter(isLocalQueuedRow).map(row => ({
      id: row.id,
      text: row.text,
      issuedBy: row.issuedBy,
      issuedAt: row.issuedAt,
      ...(row.attachments !== undefined && row.attachments.length > 0
        ? { attachments: [...row.attachments] }
        : {}),
      ...(row.holdForTurnEnd === true ? { holdForTurnEnd: true } : {}),
    }));
    if (next.length > 0) byChat[chatId] = next;
  }
  return byChat;
};

export const isQueuedLocalBound = (): boolean => persist !== undefined;

export const bindQueuedLocal = async (
  disk: DocDisk,
  orgId: string,
  userId: string,
): Promise<void> => {
  persist = { disk, orgId, userId };
  const saved = await disk.loadQueuedLocal(orgId, userId);
  queuedLocalStore.setState({
    byChat: parseSaved(saved as Record<string, unknown> | undefined),
  });
};

export const resetQueuedLocal = (): void => {
  persist = undefined;
  queuedLocalStore.setState({ byChat: {} });
};

export const localQueuedFor = (chatId: string): LocalQueuedMessage[] =>
  queuedLocalStore.getState().byChat[chatId] ?? [];

export const isLocalQueued = (chatId: string, id: string): boolean =>
  localQueuedFor(chatId).some(q => q.id === id);

export const addLocalQueued = (
  chatId: string,
  row: LocalQueuedMessage,
): Promise<void> => {
  queuedLocalStore.setState(s => {
    const cur = s.byChat[chatId] ?? [];
    if (cur.some(q => q.id === row.id)) return s;
    return { byChat: { ...s.byChat, [chatId]: [...cur, row] } };
  });
  return persistNow();
};

export const removeLocalQueued = (
  chatId: string,
  id: string,
): Promise<void> => {
  const cur = localQueuedFor(chatId);
  if (!cur.some(q => q.id === id)) return Promise.resolve();
  queuedLocalStore.setState(s => {
    const next = (s.byChat[chatId] ?? []).filter(q => q.id !== id);
    const byChat = { ...s.byChat };
    if (next.length === 0) delete byChat[chatId];
    else byChat[chatId] = next;
    return { byChat };
  });
  return persistNow();
};

/** Drop sidecar ids that are no longer in the live (doc) queue. */
export const reconcileLocalQueued = (
  chatId: string,
  liveIds: ReadonlySet<string>,
): Promise<void> => {
  const cur = localQueuedFor(chatId);
  if (cur.length === 0) return Promise.resolve();
  const next = cur.filter(q => liveIds.has(q.id));
  if (next.length === cur.length) return Promise.resolve();
  queuedLocalStore.setState(s => {
    const byChat = { ...s.byChat };
    if (next.length === 0) delete byChat[chatId];
    else byChat[chatId] = next;
    return { byChat };
  });
  return persistNow();
};

export const moveLocalQueued = (
  chatId: string,
  id: string,
  toIndex: number,
): boolean => {
  const cur = localQueuedFor(chatId);
  const from = cur.findIndex(q => q.id === id);
  if (from < 0) return false;
  const to = Math.min(Math.max(toIndex, 0), cur.length - 1);
  if (from === to) return false;
  const next = [...cur];
  const [row] = next.splice(from, 1);
  if (row === undefined) return false;
  next.splice(to, 0, row);
  queuedLocalStore.setState(s => ({
    byChat: { ...s.byChat, [chatId]: next },
  }));
  persistNow().catch(() => {});
  return true;
};

/** Live rows first; sidecar-only ids appended (relay while the host is down). */
export const displayedQueue = (
  chatId: string,
  live: readonly QueuedMessage[],
): QueuedMessage[] => {
  const local = localQueuedFor(chatId);
  if (local.length === 0) return live as QueuedMessage[];
  const seen = new Set(live.map(q => q.id));
  const extra: QueuedMessage[] = [];
  for (const row of local) {
    if (seen.has(row.id)) continue;
    extra.push({
      id: row.id,
      text: row.text,
      issuedBy: row.issuedBy,
      issuedAt: row.issuedAt,
      ...(row.attachments !== undefined
        ? { attachments: row.attachments }
        : {}),
      ...(row.holdForTurnEnd === true ? { holdForTurnEnd: true } : {}),
    });
  }
  return extra.length === 0 ? (live as QueuedMessage[]) : [...live, ...extra];
};

const EMPTY_IDS: ReadonlySet<string> = new Set();

export const useLocalQueuedIds = (chatId: string): ReadonlySet<string> => {
  const rows = useStore(queuedLocalStore, s => s.byChat[chatId]);
  return useMemo(
    () =>
      rows === undefined || rows.length === 0
        ? EMPTY_IDS
        : new Set(rows.map(r => r.id)),
    [rows],
  );
};
