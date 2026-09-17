// Small persisted UI preferences (account-scoped `uiPrefs.json` next to
// drafts.json). Currently: the composer's live-action preference — Queue vs
// Steer — switched by the live pill's long-press/menu.

import { createStore, useStore } from 'zustand';
import type { DocDisk } from '../native/docDisk';

export interface UiPrefs {
  /** ComposerView.swift: queue-first when supported; the user may prefer
   * steering into the live turn instead. */
  liveActionPrefersSteer: boolean;
}

export const uiPrefsStore = createStore<UiPrefs>(() => ({
  liveActionPrefersSteer: false,
}));

let persist: { disk: DocDisk; orgId: string; userId: string } | undefined;

export const bindUiPrefs = async (
  disk: DocDisk,
  orgId: string,
  userId: string,
): Promise<void> => {
  persist = { disk, orgId, userId };
  const saved = await disk.loadUiPrefs(orgId, userId);
  if (saved !== undefined)
    uiPrefsStore.setState(s => ({ ...s, ...(saved as Partial<UiPrefs>) }));
};

export const unbindUiPrefs = (): void => {
  persist = undefined;
};

export const setLiveActionPrefersSteer = (v: boolean): void => {
  uiPrefsStore.setState({ liveActionPrefersSteer: v });
  persist?.disk
    .saveUiPrefs(persist.orgId, persist.userId, {
      ...uiPrefsStore.getState(),
    })
    .catch(() => {});
};

export const useLiveActionPrefersSteer = (): boolean =>
  useStore(uiPrefsStore, s => s.liveActionPrefersSteer);
