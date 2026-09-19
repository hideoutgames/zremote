// expo-haptics thin wrappers; every call is a no-op when haptics are
// unavailable (e.g. simulator without haptics support) or the user has
// turned them off in Settings.

import * as Haptics from 'expo-haptics';
import { uiPrefsStore } from '../state/uiPrefs';

const enabled = (): boolean => uiPrefsStore.getState().hapticsEnabled !== false;

export const selectionTick = (): void => {
  if (!enabled()) return;
  Haptics.selectionAsync().catch(() => {});
};

export const impact = (
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void => {
  if (!enabled()) return;
  Haptics.impactAsync(style).catch(() => {});
};

export const notify = (
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType
    .Success,
): void => {
  if (!enabled()) return;
  Haptics.notificationAsync(type).catch(() => {});
};
