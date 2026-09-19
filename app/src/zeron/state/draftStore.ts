// Per-chat composer drafts. Persisted (debounced 300ms, via the injected
// clock) to `drafts.json` in the account scope — drafts survive session
// switches and are isolated per org/user.

import { createStore, useStore } from 'zustand';
import { systemClock, type Clock } from '../transport/clock';
import type { DocDisk } from '../native/docDisk';
import { newId } from '../doc/sessionDoc';

export interface StagedAttachment {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  size: number;
  localUri: string;
  uploadState: 'staged' | 'uploading' | 'uploaded' | 'failed';
  progress?: number;
  remoteRef?: string;
}

export interface Draft {
  text: string;
  attachments: StagedAttachment[];
  /** New-worktree choice carried to the FIRST run of a fresh session
   * (RunRequest.worktree) — never silently dropped. */
  pendingWorktree?: import('../protocol/types').WorktreeSpec;
  updatedAt: number;
}

export interface DraftState {
  byChat: Record<string, Draft>;
}

export const draftStore = createStore<DraftState>(() => ({ byChat: {} }));

/** Draft key for the home/detail compose composer (no chat yet). */
export const COMPOSE_DRAFT_ID = '__compose__';

const PERSIST_DEBOUNCE_MS = 300;

interface DraftPersist {
  disk: DocDisk;
  orgId: string;
  userId: string;
}

let persist: DraftPersist | undefined;
let persistTimer: unknown;
let persistClock: Clock = systemClock;

const schedulePersist = (): void => {
  if (persist === undefined) return;
  if (persistTimer !== undefined) persistClock.clearTimeout(persistTimer);
  persistTimer = persistClock.setTimeout(() => {
    persistTimer = undefined;
    const { disk, orgId, userId } = persist!;
    disk
      .saveDrafts(orgId, userId, draftStore.getState().byChat)
      .catch(() => {});
  }, PERSIST_DEBOUNCE_MS);
};

/** Bind drafts to an account; restores the saved map. Call again (or with a
 * new account) on account change — isolation is by file path. */
export const bindDrafts = async (
  disk: DocDisk,
  orgId: string,
  userId: string,
  clock: Clock = systemClock,
): Promise<void> => {
  persist = { disk, orgId, userId };
  persistClock = clock;
  const saved = await disk.loadDrafts(orgId, userId);
  draftStore.setState({ byChat: (saved ?? {}) as Record<string, Draft> });
};

export const resetDrafts = (): void => {
  if (persistTimer !== undefined) persistClock.clearTimeout(persistTimer);
  persistTimer = undefined;
  persist = undefined;
  draftStore.setState({ byChat: {} });
};

const patchDraft = (chatId: string, patch: Partial<Draft>): void => {
  draftStore.setState(s => {
    const base = s.byChat[chatId] ?? {
      text: '',
      attachments: [],
      updatedAt: 0,
    };
    return {
      byChat: {
        ...s.byChat,
        [chatId]: { ...base, ...patch, updatedAt: Date.now() },
      },
    };
  });
  schedulePersist();
};

export const setDraftText = (chatId: string, text: string): void =>
  patchDraft(chatId, { text });

export const setDraftAttachments = (
  chatId: string,
  attachments: StagedAttachment[],
): void => patchDraft(chatId, { attachments });

export const setDraftPendingWorktree = (
  chatId: string,
  pendingWorktree: Draft['pendingWorktree'],
): void => patchDraft(chatId, { pendingWorktree });

export const stageAttachment = (
  chatId: string,
  a: Omit<StagedAttachment, 'id' | 'uploadState'> &
    Partial<Pick<StagedAttachment, 'id' | 'uploadState'>>,
): StagedAttachment => {
  const staged: StagedAttachment = {
    id: a.id ?? newId(),
    uploadState: 'staged',
    ...a,
  };
  const cur = draftStore.getState().byChat[chatId];
  patchDraft(chatId, { attachments: [...(cur?.attachments ?? []), staged] });
  return staged;
};

export const updateAttachment = (
  chatId: string,
  id: string,
  patch: Partial<StagedAttachment>,
): void => {
  const cur = draftStore.getState().byChat[chatId];
  if (cur === undefined) return;
  patchDraft(chatId, {
    attachments: cur.attachments.map(a =>
      a.id === id ? { ...a, ...patch } : a,
    ),
  });
};

export const removeAttachment = (chatId: string, id: string): void => {
  const cur = draftStore.getState().byChat[chatId];
  if (cur === undefined) return;
  patchDraft(chatId, {
    attachments: cur.attachments.filter(a => a.id !== id),
  });
};

export const clearDraft = (chatId: string): void => {
  draftStore.setState(s => {
    const next = { ...s.byChat };
    delete next[chatId];
    return { byChat: next };
  });
  schedulePersist();
};

/** Move a draft (compose → new chat) without dropping attachments/text. */
export const moveDraft = (fromId: string, toId: string): void => {
  if (fromId === toId) return;
  const cur = draftStore.getState().byChat[fromId];
  draftStore.setState(s => {
    const next = { ...s.byChat };
    if (cur !== undefined) next[toId] = { ...cur, updatedAt: Date.now() };
    delete next[fromId];
    return { byChat: next };
  });
  schedulePersist();
};

export const draftFor = (chatId: string): Draft | undefined =>
  draftStore.getState().byChat[chatId];

/** A send the host rejected/expired: put the text back without clobbering
 * whatever the user has typed since (append with a blank line if needed). */
export const restoreFailedSend = (chatId: string, text: string): void => {
  const cur = draftStore.getState().byChat[chatId]?.text ?? '';
  const merged = cur === '' ? text : `${cur}\n\n${text}`;
  patchDraft(chatId, { text: merged });
};

const EMPTY_DRAFT: Draft = { text: '', attachments: [], updatedAt: 0 };

export const useDraft = (chatId: string): Draft =>
  useStore(draftStore, s => s.byChat[chatId] ?? EMPTY_DRAFT);
