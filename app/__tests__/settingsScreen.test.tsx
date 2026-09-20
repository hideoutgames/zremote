// SettingsScreen: account email only, desktop rows name + Connected, no
// edge URL / OS / version / build dump.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { authStore } from '../src/zeron/state/authStore';
import { demoModeStore } from '../src/demo/demoMode';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import type { DeviceRow } from '../src/zeron/protocol/types';

const mockedHaptics = Haptics as jest.Mocked<typeof Haptics>;

const device: DeviceRow = {
  id: 'host1',
  name: 'Studio Mac',
  platform: 'darwin',
  capabilities: ['terminal', 'files'],
  version: '0.2.72',
};

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

let tree: TestRenderer.ReactTestRenderer | undefined;

const render = async (element: React.ReactElement) => {
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

const flattenText = (c: unknown): string => {
  if (c == null || typeof c === 'boolean') return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  if (typeof c === 'object' && c !== null && 'props' in c) {
    return flattenText((c as { props: { children?: unknown } }).props.children);
  }
  return '';
};

const allText = (root: TestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(n => flattenText(n.props.children))
    .filter(s => s !== '')
    .join(' | ');

jest.useFakeTimers();

beforeEach(() => {
  demoModeStore.setState({ active: false });
  authStore.setState({
    status: {
      state: 'signedIn',
      user: { id: 'u1', email: 'andre@example.com' },
      orgId: 'org_secret_id',
    },
  });
  workspaceStore.setState({
    devices: [device],
    spaces: [],
    chats: [],
    sessions: {},
    presence: { host1: Date.now() },
    connection: 'connected',
    lastSyncAt: undefined,
  });
  uiPrefsStore.setState({
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
    colorScheme: 'system',
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  jest.clearAllTimers();
});

test('shows account email and Connected desktop — not edge URL, OS, or version', async () => {
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const text = allText(mounted.root);
  const parts = text.split(' | ');
  expect(parts).toContain('andre@example.com');
  expect(parts).toContain('Studio Mac');
  expect(parts).toContain('Connected');
  expect(parts).not.toContain('Not connected');
  expect(parts).toContain('Sign Out');
  expect(parts).toContain('Desktops');
  expect(text).not.toContain('org_secret_id');
  expect(text).not.toContain('Edge URL');
  expect(text).not.toContain('https://edge.test');
  expect(text).not.toContain('darwin');
  expect(text).not.toContain('0.2.72');
  expect(text).not.toContain('capabilities');
  expect(text).not.toContain('terminal');
  expect(text).not.toContain('0.1.0');
  expect(text).not.toContain('Build');
});

test('appearance group offers a wallpaper slider and hides effects until set', async () => {
  uiPrefsStore.setState({
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
  });
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const text = allText(mounted.root);
  expect(text).toContain('Appearance');
  expect(text).toContain('Theme');
  expect(text).toContain('System');
  expect(text).toContain('Background');
  expect(text).toContain(
    'Add an image behind threads, chats, and new threads.',
  );
  expect(text).not.toContain('Choose image');
  expect(text).not.toContain('Replace image');
  expect(
    mounted.root.findAll(
      n =>
        n.props.testID === 'settings-background-none' &&
        typeof n.props.onPress === 'function',
    ).length,
  ).toBe(1);
  expect(
    mounted.root.findAll(
      n =>
        n.props.testID === 'settings-background-custom' &&
        typeof n.props.onPress === 'function',
    ).length,
  ).toBe(1);
  expect(
    mounted.root.findAll(
      n =>
        n.props.testID === 'settings-background-preset-emma' &&
        typeof n.props.onPress === 'function',
    ).length,
  ).toBe(1);
  expect(
    mounted.root.findAll(n => n.props.testID === 'settings-background-effects')
      .length,
  ).toBe(0);
  expect(
    mounted.root.findAll(n => n.props.testID === 'top-chrome-fade').length,
  ).toBe(0);
});

test('custom wallpaper shows effects without the filename', async () => {
  uiPrefsStore.setState({
    newThreadComposerBackground: {
      kind: 'custom',
      uri: 'file:///docs/new-thread-backgrounds/x.png',
      name: 'sunset.png',
    },
    newThreadBackgroundEffect: 'none',
  });
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const text = allText(mounted.root);
  expect(text).not.toContain('sunset.png');
  expect(text).not.toContain('Replace image');
  expect(text).toContain('Background effect');
  expect(text).toContain('Shows the original artwork.');
  expect(
    mounted.root.findAll(n => n.props.testID === 'settings-background-thumb')
      .length,
  ).toBe(1);
  expect(
    mounted.root.findAll(
      n =>
        n.props.testID === 'settings-background-effect-ascii' &&
        typeof n.props.onPress === 'function',
    ).length,
  ).toBe(1);
  expect(
    mounted.root.findAll(
      n => n.props.testID === 'settings-background-effect-segments',
    ).length,
  ).toBe(1);
});

test('choosing a bundled preset selects it and reveals effects', async () => {
  uiPrefsStore.setState({
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
  });
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const tile = mounted.root.findAll(
    n =>
      n.props.testID === 'settings-background-preset-emma' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => {
    tile.props.onPress();
  });
  expect(uiPrefsStore.getState().newThreadComposerBackground).toEqual({
    kind: 'preset',
    id: 'emma',
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'settings-background-effects')
      .length,
  ).toBe(1);
  const text = allText(mounted.root);
  expect(text).not.toContain('emma');
  expect(text).not.toContain('unsplash');
});

test('stale presence shows Not connected', async () => {
  workspaceStore.setState({
    presence: { host1: Date.now() - 60_000 },
  });
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const parts = allText(mounted.root).split(' | ');
  expect(parts).toContain('Studio Mac');
  expect(parts).toContain('Not connected');
  expect(parts).not.toContain('Connected');
});

test('opening a desktop uses the device name as title and Settings as back', async () => {
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const row = mounted.root.findAll(
    n =>
      n.props.testID === 'settings-device-host1' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => {
    row.props.onPress();
  });
  const text = allText(mounted.root);
  expect(text).toContain('Studio Mac');
  expect(text).toContain('Settings');
  expect(text).toContain('Name');
  expect(text).not.toContain('Desktops');
  expect(text).not.toContain('Session Titles');
  const parts = text.split(' | ');
  expect(parts).not.toContain('Harness');
  expect(parts).not.toContain('Model');
});

test('theme row defaults to System and choosing Dark updates the store', async () => {
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const text = allText(mounted.root);
  expect(text).toContain('Theme');
  expect(text).toContain('System');
  const row = mounted.root.findAll(
    n =>
      n.props.testID === 'settings-theme' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => {
    row.props.onPress();
  });
  const page = allText(mounted.root);
  expect(page).toContain('System');
  expect(page).toContain('Dark');
  expect(page).toContain('Light');
  expect(page).not.toContain('Background');
  const dark = mounted.root.findAll(
    n =>
      n.props.testID === 'settings-theme-dark' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => {
    dark.props.onPress();
  });
  expect(uiPrefsStore.getState().colorScheme).toBe('dark');
});

test('enabling haptics plays a confirmation impact', async () => {
  uiPrefsStore.setState({ hapticsEnabled: false });
  mockedHaptics.impactAsync.mockClear();
  const mounted = await render(<SettingsScreen onClose={() => {}} />);
  const sw = mounted.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Haptics' &&
      typeof n.props.onValueChange === 'function',
  )[0];
  await act(async () => {
    sw.props.onValueChange(true);
  });
  expect(uiPrefsStore.getState().hapticsEnabled).toBe(true);
  expect(mockedHaptics.impactAsync).toHaveBeenCalledTimes(1);
});
