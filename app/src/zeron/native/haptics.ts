// expo-haptics thin wrappers; every call is a no-op when haptics are
// unavailable (e.g. simulator without haptics support).

import * as Haptics from 'expo-haptics';

export const selectionTick = (): void => {
  Haptics.selectionAsync().catch(() => {});
};

export const impact = (
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void => {
  Haptics.impactAsync(style).catch(() => {});
};

export const notify = (
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType
    .Success,
): void => {
  Haptics.notificationAsync(type).catch(() => {});
};
