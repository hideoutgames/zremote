// Foreground run-finished haptic: working/awaitingInput → idle/errored
// while the app is active. First observation is not a finish (don't buzz
// on bind). Multiple finishes in one workspace tick coalesce to one pulse.
// Background coverage is the edge APNs producer.

import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { notify } from '../zeron/native/haptics';
import { workspaceStore } from '../zeron/state/workspaceStore';

export const isRunFinishedFlip = (
  prev: string | undefined,
  status: string,
): boolean =>
  (prev === 'working' || prev === 'awaitingInput') &&
  (status === 'idle' || status === 'errored');

export const shouldRunFinishedHaptic = (a: {
  prevStatus: string | undefined;
  status: string;
  appState: string;
}): boolean =>
  a.appState === 'active' && isRunFinishedFlip(a.prevStatus, a.status);

export type BindRunFinishedHapticDeps = {
  appState?: () => string;
};

export const bindRunFinishedHaptic = (
  deps: BindRunFinishedHapticDeps = {},
): (() => void) => {
  const appState = deps.appState ?? (() => AppState.currentState);
  const lastStatus = new Map<string, string | undefined>();

  const scan = (): void => {
    const { sessions } = workspaceStore.getState();
    let finished = false;
    let failed = false;
    for (const row of Object.values(sessions)) {
      const prev = lastStatus.get(row.chatId);
      lastStatus.set(row.chatId, row.status);
      if (
        shouldRunFinishedHaptic({
          prevStatus: prev,
          status: row.status,
          appState: appState(),
        })
      ) {
        finished = true;
        if (row.status === 'errored') failed = true;
      }
    }
    if (!finished) return;
    notify(
      failed
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Success,
    );
  };

  const unsub = workspaceStore.subscribe(scan);
  scan();
  return unsub;
};
