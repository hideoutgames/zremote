import * as Haptics from 'expo-haptics';
import {
  bindRunFinishedHaptic,
  isRunFinishedFlip,
  shouldRunFinishedHaptic,
} from '../src/notifications/runFinishedHaptic';
import { setHapticsEnabled, uiPrefsStore } from '../src/zeron/state/uiPrefs';
import {
  resetWorkspace,
  workspaceStore,
} from '../src/zeron/state/workspaceStore';
import type { SessionRow, SessionStatus } from '../src/zeron/protocol/types';

const mocked = Haptics as jest.Mocked<typeof Haptics>;

const row = (chatId: string, status: SessionStatus): SessionRow => ({
  chatId,
  deviceId: 'd1',
  status,
  updatedAt: 1,
});

beforeEach(() => {
  mocked.notificationAsync.mockClear();
  uiPrefsStore.setState({ hapticsEnabled: true });
  resetWorkspace();
});

test('isRunFinishedFlip: working/awaitingInput → idle/errored', () => {
  expect(isRunFinishedFlip('working', 'idle')).toBe(true);
  expect(isRunFinishedFlip('awaitingInput', 'idle')).toBe(true);
  expect(isRunFinishedFlip('working', 'errored')).toBe(true);
  expect(isRunFinishedFlip('awaitingInput', 'errored')).toBe(true);
});

test('isRunFinishedFlip: first observe and non-finish transitions', () => {
  expect(isRunFinishedFlip(undefined, 'idle')).toBe(false);
  expect(isRunFinishedFlip(undefined, 'errored')).toBe(false);
  expect(isRunFinishedFlip('working', 'awaitingInput')).toBe(false);
  expect(isRunFinishedFlip('idle', 'idle')).toBe(false);
  expect(isRunFinishedFlip('idle', 'working')).toBe(false);
});

test('shouldRunFinishedHaptic requires the app to be active', () => {
  expect(
    shouldRunFinishedHaptic({
      prevStatus: 'working',
      status: 'idle',
      appState: 'active',
    }),
  ).toBe(true);
  expect(
    shouldRunFinishedHaptic({
      prevStatus: 'working',
      status: 'idle',
      appState: 'background',
    }),
  ).toBe(false);
  expect(
    shouldRunFinishedHaptic({
      prevStatus: 'working',
      status: 'idle',
      appState: 'inactive',
    }),
  ).toBe(false);
});

test('binder fires once when a working session goes idle in the foreground', () => {
  workspaceStore.setState({ sessions: { c1: row('c1', 'working') } });
  const unbind = bindRunFinishedHaptic({ appState: () => 'active' });
  expect(mocked.notificationAsync).not.toHaveBeenCalled();
  workspaceStore.setState({ sessions: { c1: row('c1', 'idle') } });
  expect(mocked.notificationAsync).toHaveBeenCalledTimes(1);
  expect(mocked.notificationAsync).toHaveBeenCalledWith(
    Haptics.NotificationFeedbackType.Success,
  );
  unbind();
});

test('binder uses Error haptic on an errored finish', () => {
  workspaceStore.setState({ sessions: { c1: row('c1', 'working') } });
  const unbind = bindRunFinishedHaptic({ appState: () => 'active' });
  workspaceStore.setState({ sessions: { c1: row('c1', 'errored') } });
  expect(mocked.notificationAsync).toHaveBeenCalledWith(
    Haptics.NotificationFeedbackType.Error,
  );
  unbind();
});

test('binder coalesces two finishes in one tick into a single haptic', () => {
  workspaceStore.setState({
    sessions: { c1: row('c1', 'working'), c2: row('c2', 'working') },
  });
  const unbind = bindRunFinishedHaptic({ appState: () => 'active' });
  workspaceStore.setState({
    sessions: { c1: row('c1', 'idle'), c2: row('c2', 'idle') },
  });
  expect(mocked.notificationAsync).toHaveBeenCalledTimes(1);
  unbind();
});

test('binder skips background (edge APNs covers lock screen)', () => {
  workspaceStore.setState({ sessions: { c1: row('c1', 'working') } });
  const unbind = bindRunFinishedHaptic({ appState: () => 'background' });
  workspaceStore.setState({ sessions: { c1: row('c1', 'idle') } });
  expect(mocked.notificationAsync).not.toHaveBeenCalled();
  unbind();
});

test('binder no-ops when the user turns haptics off', () => {
  setHapticsEnabled(false);
  workspaceStore.setState({ sessions: { c1: row('c1', 'working') } });
  const unbind = bindRunFinishedHaptic({ appState: () => 'active' });
  workspaceStore.setState({ sessions: { c1: row('c1', 'idle') } });
  expect(mocked.notificationAsync).not.toHaveBeenCalled();
  unbind();
});
