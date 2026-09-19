// Small persisted UI preferences (account-scoped `uiPrefs.json` next to
// drafts.json). Currently: the composer's live-action preference — Queue vs
// Steer — switched by the live pill's long-press/menu.

import { createStore, useStore } from 'zustand';
import type { DocDisk } from '../native/docDisk';
import { rememberRecentModel, type RecentModel } from './recentModels';
import { modelRowKey, type ModelSettings } from '../../components/modelPicker';

export interface UiPrefs {
  /** ComposerView.swift: queue-first when supported; the user may prefer
   * steering into the live turn instead. */
  liveActionPrefersSteer: boolean;
  /** Live Activities on/off + whether host/project show on the Lock Screen. */
  liveActivitiesEnabled: boolean;
  liveActivityShowHost: boolean;
  /** APNs finish banners (run completed / failed). Off → token DELETE. */
  notificationsEnabled: boolean;
  /** Composer / system haptics (effort slider detents). Off → no-op. */
  hapticsEnabled: boolean;
  /** BCP-47 locale for the dictation model (Settings → Dictation). */
  dictationLocale: string;
  /** Force the Loro-free relay session mode (Settings → Sync mode). When
   * Loro init fails, relay mode is selected regardless. */
  forceRelayMode: boolean;
  /** iPad threads sidebar collapsed (AdaptiveShell, ≥700pt only). */
  sidebarCollapsed: boolean;
  /** Per-chat composer Plan mode (prefixes the outgoing prompt). */
  planModeByChat: Record<string, boolean>;
  /** Extra composer input height from the grabber, in points. */
  composerExtraHeight: number;
  /** Last-picked models for the composer Liquid Glass menu. */
  recentModels: RecentModel[];
  /** Local-only pin-to-top (no registry pin field). */
  pinnedChatIds: string[];
  /** Last compose-composer settings (host/space/model). */
  composeDefaults?: ComposeDefaults;
  /** Last-used effort / Fast per catalog model (`harness:modelId`). */
  modelSettingsByKey: Record<string, ModelSettings>;
}

export interface ComposeDefaults {
  deviceId: string;
  spaceId?: string;
  harness: string;
  model: string;
  reasoning?: string;
}

export const uiPrefsStore = createStore<UiPrefs>(() => ({
  liveActionPrefersSteer: false,
  liveActivitiesEnabled: true,
  liveActivityShowHost: true,
  notificationsEnabled: true,
  hapticsEnabled: true,
  dictationLocale: 'en-US',
  forceRelayMode: false,
  sidebarCollapsed: false,
  planModeByChat: {},
  composerExtraHeight: 0,
  recentModels: [],
  pinnedChatIds: [],
  modelSettingsByKey: {},
}));

let persist: { disk: DocDisk; orgId: string; userId: string } | undefined;

export const bindUiPrefs = async (
  disk: DocDisk,
  orgId: string,
  userId: string,
): Promise<void> => {
  persist = { disk, orgId, userId };
  const saved = await disk.loadUiPrefs(orgId, userId);
  if (saved !== undefined) {
    const patch = saved as Partial<UiPrefs>;
    uiPrefsStore.setState(s => ({
      ...s,
      ...patch,
      modelSettingsByKey: {
        ...s.modelSettingsByKey,
        ...(patch.modelSettingsByKey ?? {}),
      },
    }));
  }
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

export const setHapticsEnabled = (v: boolean): void => {
  uiPrefsStore.setState({ hapticsEnabled: v });
  save();
};

export const useHapticsEnabled = (): boolean =>
  useStore(uiPrefsStore, s => s.hapticsEnabled);

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

/** Live grabber extra height — no disk write (pan frames). */
export const setComposerExtraHeightLive = (v: number): void => {
  uiPrefsStore.setState({ composerExtraHeight: v });
};

export const setComposerExtraHeight = (v: number): void => {
  uiPrefsStore.setState({ composerExtraHeight: v });
  save();
};

export const useComposerExtraHeight = (): number =>
  useStore(uiPrefsStore, s => s.composerExtraHeight);

export const rememberModelPick = (pick: RecentModel): void => {
  uiPrefsStore.setState(s => ({
    recentModels: rememberRecentModel(s.recentModels, pick),
  }));
  save();
};

export const useRecentModels = (): RecentModel[] =>
  useStore(uiPrefsStore, s => s.recentModels);

export const isChatPinned = (chatId: string): boolean =>
  uiPrefsStore.getState().pinnedChatIds.includes(chatId);

export const toggleChatPinned = (chatId: string): void => {
  uiPrefsStore.setState(s => {
    const has = s.pinnedChatIds.includes(chatId);
    return {
      pinnedChatIds: has
        ? s.pinnedChatIds.filter(id => id !== chatId)
        : [chatId, ...s.pinnedChatIds],
    };
  });
  save();
};

export const usePinnedChatIds = (): string[] =>
  useStore(uiPrefsStore, s => s.pinnedChatIds);

export const useChatPinned = (chatId: string): boolean =>
  useStore(uiPrefsStore, s => s.pinnedChatIds.includes(chatId));

export const setComposeDefaults = (patch: Partial<ComposeDefaults>): void => {
  uiPrefsStore.setState(s => {
    const base: ComposeDefaults = s.composeDefaults ?? {
      deviceId: '',
      harness: '',
      model: '',
    };
    return { composeDefaults: { ...base, ...patch } };
  });
  save();
};

export const rememberComposeDefaults = (defaults: ComposeDefaults): void => {
  uiPrefsStore.setState({ composeDefaults: defaults });
  save();
};

export const useComposeDefaults = (): ComposeDefaults | undefined =>
  useStore(uiPrefsStore, s => s.composeDefaults);

export const rememberModelSettings = (
  harness: string,
  model: string,
  patch: ModelSettings,
): void => {
  if (harness === '' || model === '') return;
  const key = modelRowKey(harness, model);
  uiPrefsStore.setState(s => {
    const prev = s.modelSettingsByKey[key] ?? {};
    return {
      modelSettingsByKey: {
        ...s.modelSettingsByKey,
        [key]: {
          ...prev,
          ...patch,
          modelOptions:
            patch.modelOptions === undefined
              ? prev.modelOptions
              : { ...(prev.modelOptions ?? {}), ...patch.modelOptions },
        },
      },
    };
  });
  save();
};

export const modelSettingsFor = (
  harness: string,
  model: string,
): ModelSettings | undefined =>
  uiPrefsStore.getState().modelSettingsByKey[modelRowKey(harness, model)];

export const useModelSettingsMap = (): Record<string, ModelSettings> =>
  useStore(uiPrefsStore, s => s.modelSettingsByKey);
