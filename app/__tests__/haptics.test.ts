import * as Haptics from 'expo-haptics';
import {
  selectionTick,
  impact,
  notify,
  prepareSelection,
} from '../src/zeron/native/haptics';
import { setHapticsEnabled, uiPrefsStore } from '../src/zeron/state/uiPrefs';

const mocked = Haptics as jest.Mocked<typeof Haptics>;

beforeEach(() => {
  mocked.selectionAsync.mockClear();
  mocked.impactAsync.mockClear();
  mocked.notificationAsync.mockClear();
  mocked.prepareSelectionAsync.mockClear();
  uiPrefsStore.setState({ hapticsEnabled: true });
});

test('selectionTick fires when haptics are enabled', () => {
  selectionTick();
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
});

test('prepareSelection warms the engine when haptics are enabled', () => {
  prepareSelection();
  expect(mocked.prepareSelectionAsync).toHaveBeenCalledTimes(1);
});

test('haptic wrappers no-op when the user turns them off', () => {
  setHapticsEnabled(false);
  selectionTick();
  impact();
  notify();
  prepareSelection();
  expect(mocked.selectionAsync).not.toHaveBeenCalled();
  expect(mocked.impactAsync).not.toHaveBeenCalled();
  expect(mocked.notificationAsync).not.toHaveBeenCalled();
  expect(mocked.prepareSelectionAsync).not.toHaveBeenCalled();
});
