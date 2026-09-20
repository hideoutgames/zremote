// In-memory freeze of a run's working clock. The host clears
// sessions[chatId].startedAt on idle/errored, so completed bubbles cannot
// re-read the live timer. We remember the start while working, stamp the
// end on a finish flip, and attach it to the last assistant message.

import { createStore } from 'zustand';
import { isRunFinishedFlip } from '../../notifications/runFinishedHaptic';
import type { MessageEntry, SessionRow } from '../protocol/types';
import { getSessionStore } from './sessionStores';
import { workspaceStore } from './workspaceStore';
import { formatWorkedDurationRange } from './workingElapsed';

export interface FrozenWorkedDuration {
  startedAt: number;
  endedAt: number;
}

export interface WorkedDurationState {
  byMessageId: Record<string, FrozenWorkedDuration>;
  pendingByChat: Record<string, FrozenWorkedDuration>;
  lastStartedAt: Record<string, number>;
}

const EMPTY: WorkedDurationState = {
  byMessageId: {},
  pendingByChat: {},
  lastStartedAt: {},
};

export const workedDurationStore = createStore<WorkedDurationState>(() => ({
  ...EMPTY,
}));

let lastStatus = new Map<string, string | undefined>();

export const resetWorkedDurations = (): void => {
  lastStatus = new Map();
  workedDurationStore.setState({ ...EMPTY });
};

export const rememberWorkingStart = (
  chatId: string,
  startedAt: number,
): void => {
  workedDurationStore.setState(s => ({
    lastStartedAt: { ...s.lastStartedAt, [chatId]: startedAt },
  }));
};

const lastAttachableAssistant = (
  entries: readonly MessageEntry[],
): MessageEntry | undefined => {
  const last = entries[entries.length - 1];
  if (last?.role !== 'assistant') return undefined;
  if (last.status !== 'complete' && last.status !== 'aborted') return undefined;
  return last;
};

/** Bind a pending freeze to the last complete/aborted assistant, if any. */
export const bindPendingWorkedDuration = (chatId: string): void => {
  const pending = workedDurationStore.getState().pendingByChat[chatId];
  if (pending === undefined) return;
  const last = lastAttachableAssistant(
    getSessionStore(chatId).getState().entries,
  );
  if (last === undefined) return;
  workedDurationStore.setState(s => {
    if (s.pendingByChat[chatId] === undefined) return s;
    const pendingByChat = { ...s.pendingByChat };
    delete pendingByChat[chatId];
    if (s.byMessageId[last.id] !== undefined) return { pendingByChat };
    return {
      byMessageId: { ...s.byMessageId, [last.id]: pending },
      pendingByChat,
    };
  });
};

export const freezeWorkedDuration = (
  chatId: string,
  endedAt: number,
): FrozenWorkedDuration | undefined => {
  const s = workedDurationStore.getState();
  const existing = s.pendingByChat[chatId];
  if (existing !== undefined) {
    bindPendingWorkedDuration(chatId);
    return existing;
  }
  const startedAt = s.lastStartedAt[chatId];
  if (startedAt === undefined) return undefined;
  const frozen: FrozenWorkedDuration = { startedAt, endedAt };
  const lastStartedAt = { ...s.lastStartedAt };
  delete lastStartedAt[chatId];
  workedDurationStore.setState({
    pendingByChat: { ...s.pendingByChat, [chatId]: frozen },
    lastStartedAt,
  });
  bindPendingWorkedDuration(chatId);
  return frozen;
};

export const workedForLabel = (messageId: string): string | undefined => {
  const frozen = workedDurationStore.getState().byMessageId[messageId];
  if (frozen === undefined) return undefined;
  return formatWorkedDurationRange(frozen.startedAt, frozen.endedAt);
};

const rememberFromRow = (row: SessionRow): void => {
  if (row.startedAt !== undefined) {
    rememberWorkingStart(row.chatId, row.startedAt);
    return;
  }
  if (workedDurationStore.getState().lastStartedAt[row.chatId] === undefined)
    rememberWorkingStart(row.chatId, row.updatedAt);
};

export const scanWorkedDurations = (): void => {
  const { sessions } = workspaceStore.getState();
  for (const row of Object.values(sessions)) {
    const prev = lastStatus.get(row.chatId);
    lastStatus.set(row.chatId, row.status);
    if (row.status === 'working' || row.status === 'awaitingInput') {
      rememberFromRow(row);
      continue;
    }
    if (isRunFinishedFlip(prev, row.status))
      freezeWorkedDuration(row.chatId, row.updatedAt);
  }
};

export const bindWorkedDuration = (): (() => void) => {
  lastStatus = new Map();
  const unsub = workspaceStore.subscribe(scanWorkedDurations);
  scanWorkedDurations();
  return unsub;
};
