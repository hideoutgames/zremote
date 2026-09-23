// Per-chat session stores (docs/ARCHITECTURE.md "Command plane"): one store
// per open chat, fed ONLY by SessionController projections + room events.
// `runPhase` is the composer/status-bar state machine — precedence is
// documented at the function.

import { useStore } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { effectiveStatus } from '../protocol/entities';
import {
  openQuestion,
  sameOpenQuestion,
  type OpenQuestion,
} from '../protocol/detectQuestion';
import type {
  Chat,
  ContextUsage,
  MessageEntry,
  QueuedMessage,
  SessionCommandEntry,
  SessionRow,
  UserInputQuestion,
} from '../protocol/types';
import type { SessionDocMeta } from '../doc/sessionDoc';
import { draftFor, restoreFailedSend } from './draftStore';

export interface PendingSend {
  messageId: string;
  text: string;
  at: number;
  /** Delivery-grace clock, reset by the retry affordance. */
  started: number;
}

export interface FailedSend extends PendingSend {
  commandId: string;
  status: 'rejected' | 'expired' | 'superseded' | 'cancelled';
}

export type RoomState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'caughtUp'
  | 'disconnected';

export interface SessionState {
  entries: MessageEntry[];
  commands: SessionCommandEntry[];
  queue: QueuedMessage[];
  meta: SessionDocMeta;
  pendingSends: PendingSend[];
  failedSends: FailedSend[];
  /** Own commands whose Loro updates have not been acked by the room yet. */
  unsyncedCommandIds: string[];
  room: RoomState;
  /** Queue rows with an in-flight host action (sendNow/steerNow/remove) —
   * SessionQueue.swift queueActionsPending. */
  queueActionsPending: Set<string>;
  /** Question ids the user answered or dismissed through the panel.
   * App-detected tool/text questions may keep signalling after the answer
   * ships (a dead run's tool never resolves, the trailing text stays last
   * until the reply lands), so they're suppressed until a new question id
   * appears. */
  answeredQuestionIds: Set<string>;
  queueActionError?: string;
  lastError?: string;
  hostDeviceId?: string;
}

const EMPTY_SESSION: SessionState = {
  entries: [],
  commands: [],
  queue: [],
  meta: {},
  pendingSends: [],
  failedSends: [],
  unsyncedCommandIds: [],
  room: 'idle',
  queueActionsPending: new Set(),
  answeredQuestionIds: new Set(),
};

const stores = new Map<string, StoreApi<SessionState>>();

export const getSessionStore = (chatId: string) => {
  let s = stores.get(chatId);
  if (s === undefined) {
    s = createStore<SessionState>(() => EMPTY_SESSION);
    stores.set(chatId, s);
  }
  return s;
};

export const removeSessionStore = (chatId: string): void => {
  stores.delete(chatId);
};

export const resetSessionStores = (): void => {
  stores.clear();
};

export const recordFailedSend = (chatId: string, failed: FailedSend): void => {
  getSessionStore(chatId).setState(s => ({
    pendingSends: s.pendingSends.filter(p => p.messageId !== failed.messageId),
    failedSends: s.failedSends.some(f => f.messageId === failed.messageId)
      ? s.failedSends
      : [...s.failedSends, failed],
  }));
  const cur = draftFor(chatId)?.text ?? '';
  if (cur.trim() === '') restoreFailedSend(chatId, failed.text);
};

export const dismissFailedSend = (chatId: string, messageId: string): void => {
  getSessionStore(chatId).setState(s => ({
    failedSends: s.failedSends.filter(f => f.messageId !== messageId),
  }));
};

/** Record a question the panel answered or dismissed so openQuestion stops
 * surfacing it (tool/text signals can outlive the answer; a host input part
 * may stay unresolved). */
export const markQuestionAnswered = (
  chatId: string,
  questionId: string,
): void => {
  const store = getSessionStore(chatId);
  if (store.getState().answeredQuestionIds.has(questionId)) return;
  store.setState(s => ({
    answeredQuestionIds: new Set([...s.answeredQuestionIds, questionId]),
  }));
};

/** Reorder the store's queue rows directly — the no-runtime path (test
 * mode) has no SessionController/Loro doc to write through. */
export const moveQueuedInStore = (
  chatId: string,
  id: string,
  toIndex: number,
): boolean => {
  const store = getSessionStore(chatId);
  const queue = store.getState().queue;
  const from = queue.findIndex(q => q.id === id);
  if (from < 0) return false;
  const to = Math.min(Math.max(toIndex, 0), queue.length - 1);
  if (from === to) return false;
  const next = [...queue];
  const [row] = next.splice(from, 1);
  if (row === undefined) return false;
  next.splice(to, 0, row);
  store.setState({ queue: next });
  return true;
};

/** Append a locally-sent user message — the no-runtime path (test mode) has
 * no SessionController/doc to write through. */
export const appendSentMessage = (
  chatId: string,
  text: string,
  deviceId = 'local',
): void => {
  const store = getSessionStore(chatId);
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.setState(s => ({
    entries: [
      ...s.entries,
      {
        id,
        role: 'user',
        parts: [{ kind: 'text' as const, id: `${id}-p`, text }],
        createdAt: Date.now(),
        deviceId,
      },
    ],
  }));
};

// ── runPhase ───────────────────────────────────────────────────────────

export interface OpenInputRequest {
  entryId: string;
  requestId: string;
  questions: UserInputQuestion[];
}

/** SessionStore.openInputRequest: newest-first, unresolved, non-empty. */
export const openInputRequest = (
  entries: readonly MessageEntry[],
): OpenInputRequest | undefined => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    for (let j = entry.parts.length - 1; j >= 0; j--) {
      const part = entry.parts[j];
      if (
        part.kind === 'input' &&
        !part.resolved &&
        part.questions.length > 0
      ) {
        return {
          entryId: entry.id,
          requestId: part.requestId,
          questions: part.questions,
        };
      }
    }
  }
  return undefined;
};

export type RunPhase =
  | 'stopping'
  | 'awaitingInput'
  | 'working'
  | 'queuedLocally'
  | 'synchronized'
  | 'errored'
  | 'stale'
  | 'idle';

const TERMINAL_COMMAND_STATUSES = new Set([
  'applied',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
]);

/**
 * runPhase precedence (first match wins):
 *  1. `stopping`      — an own `interrupt` command is still pending.
 *  2. `awaitingInput` — an unresolved, non-empty input part exists.
 *  3. `working`       — the session row's effective status is `working`
 *                       (fresh; stale working rows fall through to `stale`)
 *                       OR an entry is streaming.
 *  4. `queuedLocally` — an own run/steer command is pending AND its update
 *                       hasn't been acked by the room (`unsyncedCommandIds`).
 *  5. `synchronized`  — an own run/steer command is pending, acked, but the
 *                       session row hasn't gone `working` yet.
 *  6. `errored`       — the row says errored and is unseen (row updated after
 *                       the chat's lastSeenAt).
 *  7. `stale`         — the row says working but aged past SESSION_STALE_MS
 *                       (45s) with no streaming entry.
 *  8. `idle`.
 */
export const runPhase = (
  s: SessionState,
  row: SessionRow | undefined,
  chat: Chat | undefined,
  deviceId: string,
  now: number,
): RunPhase => {
  const pending = (c: SessionCommandEntry) =>
    c.issuedBy === deviceId && !TERMINAL_COMMAND_STATUSES.has(c.status);

  if (s.commands.some(c => c.kind === 'interrupt' && pending(c)))
    return 'stopping';

  const live = effectiveStatus(row, now);
  const streaming = s.entries.some(e => e.status === 'streaming');
  const runLive = live === 'working' || live === 'awaitingInput' || streaming;
  const open = openQuestion(s.entries, s.answeredQuestionIds);
  // Host input parts stay open until answered regardless of run state;
  // app-detected tool/text questions only mark a live run awaiting input —
  // an idle thread keeps its phase even while the panel stays up.
  if (open !== undefined && (open.kind === 'input' || runLive))
    return 'awaitingInput';

  if (runLive) return 'working';

  const ownRunPending = s.commands.find(
    c => (c.kind === 'run' || c.kind === 'steer') && pending(c),
  );
  if (ownRunPending !== undefined) {
    return s.unsyncedCommandIds.includes(ownRunPending.id)
      ? 'queuedLocally'
      : 'synchronized';
  }

  if (row?.status === 'errored' && row.updatedAt > (chat?.lastSeenAt ?? 0))
    return 'errored';

  if (row?.status === 'working' && live === undefined && !streaming)
    return 'stale';

  return 'idle';
};

// ── Hooks ──────────────────────────────────────────────────────────────

export const useSessionState = (chatId: string): SessionState =>
  useStore(getSessionStore(chatId));

export const useSessionCommands = (chatId: string): SessionCommandEntry[] =>
  useStore(getSessionStore(chatId), s => s.commands);

export const useSessionQueueLength = (chatId: string): number =>
  useStore(getSessionStore(chatId), s => s.queue.length);

export const useContextUsage = (chatId: string): ContextUsage | undefined =>
  useStore(getSessionStore(chatId), s => s.meta.contextUsage);

const sameOpenInput = (
  a: OpenInputRequest | undefined,
  b: OpenInputRequest | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.entryId === b.entryId &&
    a.requestId === b.requestId &&
    a.questions === b.questions);

export const useOpenInputRequest = (
  chatId: string,
): OpenInputRequest | undefined =>
  useStoreWithEqualityFn<StoreApi<SessionState>, OpenInputRequest | undefined>(
    getSessionStore(chatId),
    s => openInputRequest(s.entries),
    sameOpenInput,
  );

/** The question to surface in the composer: host input parts, unresolved
 * question-shaped tool calls, and trailing prose questions (detectQuestion).
 * Already-answered ids are filtered via `answeredQuestionIds`. */
export const useOpenQuestion = (chatId: string): OpenQuestion | undefined =>
  useStoreWithEqualityFn<StoreApi<SessionState>, OpenQuestion | undefined>(
    getSessionStore(chatId),
    s => openQuestion(s.entries, s.answeredQuestionIds),
    sameOpenQuestion,
  );

export const useRunPhase = (
  chatId: string,
  row: SessionRow | undefined,
  chat: Chat | undefined,
  deviceId: string,
): RunPhase =>
  useStore(getSessionStore(chatId), s =>
    runPhase(s, row, chat, deviceId, Date.now()),
  );
