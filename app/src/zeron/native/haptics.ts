// Haptic wrappers. Native playback lives in a patched expo-haptics
// (view-attached generators + a retained Core Haptics engine). Every call
// is a no-op when the user has turned haptics off in Settings. Failures
// (missing native module, simulator) are logged, never thrown.

import * as Haptics from 'expo-haptics';
import { createLog } from '../log';
import { uiPrefsStore } from '../state/uiPrefs';

const log = createLog();

const enabled = (): boolean => uiPrefsStore.getState().hapticsEnabled !== false;

const fail =
  (op: string) =>
  (err: unknown): void => {
    log.warn(`haptics ${op} failed: ${String(err)}`);
  };

export const prepareSelection = (): void => {
  if (!enabled()) return;
  Haptics.prepareSelectionAsync().catch(fail('prepare'));
};

export const selectionTick = (): void => {
  if (!enabled()) return;
  Haptics.selectionAsync().catch(fail('selection'));
};

export const impact = (
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light,
): void => {
  if (!enabled()) return;
  Haptics.impactAsync(style).catch(fail('impact'));
};

export const notify = (
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType
    .Success,
): void => {
  if (!enabled()) return;
  Haptics.notificationAsync(type).catch(fail('notify'));
};
