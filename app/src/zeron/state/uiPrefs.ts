// Small persisted UI preferences (account-scoped `uiPrefs.json` next to
// drafts.json). Currently: the composer's live-action preference — Queue vs
// Steer — switched by the live pill's long-press/menu.

import { createStore, useStore } from 'zustand';
import type { DocDisk } from '../native/docDisk';

export interface UiPrefs {
  /** ComposerView.swift: queue-first when supported; the user may prefer
   * steering into the live turn instead. */
  liveActionPrefersSteer: boolean;
  /** Per-chat `RunRequest.autoApprove` — a run-time field (not ChatConfig);
   * off by default, confirm-gated in the model picker. */
  autoApproveByChat: Record<string, boolean>;
  /** Live Activities on/off + whether host/project show on the Lock Screen. */
  liveActivitiesEnabled: boolean;
  liveActivityShowHost: boolean;
  /** APNs finish banners (run completed / failed). Off → token DELETE. */
  notificationsEnabled: boolean;
  /** BCP-47 locale for the dictation model (Settings → Dictation). */
  dictationLocale: string;
  /** Force the Loro-free relay session mode (Settings → Sync mode). When
   * Loro init fails, relay mode is selected regardless. */
  forceRelayMode: boolean;
  /** iPad floating sidebar collapsed (AdaptiveShell, ≥700pt only). */
  sidebarCollapsed: boolean;
  /** Per-chat composer Plan mode (prefixes the outgoing prompt). */
  planModeByChat: Record<string, boolean>;
  /** Extra composer input height from the grabber, in points. */
  composerExtraHeight: number;
}

export const uiPrefsStore = createStore<UiPrefs>(() => ({
  liveActionPrefersSteer: false,
  autoApproveByChat: {},
  liveActivitiesEnabled: true,
  liveActivityShowHost: true,
  notificationsEnabled: true,
  dictationLocale: 'en-US',
  forceRelayMode: false,
  sidebarCollapsed: false,
  planModeByChat: {},
  composerExtraHeight: 0,
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

const save = (): void => {
  persist?.disk
    .saveUiPrefs(persist.orgId, persist.userId, {
      ...uiPrefsStore.getState(),
    })
    .catch(() => {});
};

export const setLiveActionPrefersSteer = (v: boolean): void => {
  uiPrefsStore.setState({ liveActionPrefersSteer: v });
  save();
};

export const useLiveActionPrefersSteer = (): boolean =>
  useStore(uiPrefsStore, s => s.liveActionPrefersSteer);

export const setAutoApprove = (chatId: string, v: boolean): void => {
  uiPrefsStore.setState(s => ({
    autoApproveByChat: { ...s.autoApproveByChat, [chatId]: v },
  }));
  save();
};

export const autoApproveFor = (chatId: string): boolean =>
  uiPrefsStore.getState().autoApproveByChat[chatId] === true;

export const useAutoApprove = (chatId: string): boolean =>
  useStore(uiPrefsStore, s => s.autoApproveByChat[chatId] === true);

export const setLiveActivitiesEnabled = (v: boolean): void => {
  uiPrefsStore.setState({ liveActivitiesEnabled: v });
  save();
};

export const setLiveActivityShowHost = (v: boolean): void => {
  uiPrefsStore.setState({ liveActivityShowHost: v });
  save();
};

export const useLiveActivitiesEnabled = (): boolean =>
  useStore(uiPrefsStore, s => s.liveActivitiesEnabled);

export const useLiveActivityShowHost = (): boolean =>
  useStore(uiPrefsStore, s => s.liveActivityShowHost);

export const setNotificationsEnabled = (v: boolean): void => {
  uiPrefsStore.setState({ notificationsEnabled: v });
  save();
};

export const useNotificationsEnabled = (): boolean =>
  useStore(uiPrefsStore, s => s.notificationsEnabled);

export const setDictationLocale = (v: string): void => {
  uiPrefsStore.setState({ dictationLocale: v });
  save();
};

export const useDictationLocale = (): string =>
  useStore(uiPrefsStore, s => s.dictationLocale);

export const setForceRelayMode = (v: boolean): void => {
  uiPrefsStore.setState({ forceRelayMode: v });
  save();
};

export const useForceRelayMode = (): boolean =>
  useStore(uiPrefsStore, s => s.forceRelayMode);

export const setSidebarCollapsed = (v: boolean): void => {
  uiPrefsStore.setState({ sidebarCollapsed: v });
  save();
};

export const useSidebarCollapsed = (): boolean =>
  useStore(uiPrefsStore, s => s.sidebarCollapsed);

export const setPlanMode = (chatId: string, v: boolean): void => {
  uiPrefsStore.setState(s => ({
    planModeByChat: { ...s.planModeByChat, [chatId]: v },
  }));
  save();
};

export const usePlanMode = (chatId: string): boolean =>
  useStore(uiPrefsStore, s => s.planModeByChat[chatId] === true);

export const setComposerExtraHeight = (v: number): void => {
  uiPrefsStore.setState({ composerExtraHeight: v });
  save();
};

export const useComposerExtraHeight = (): number =>
  useStore(uiPrefsStore, s => s.composerExtraHeight);
