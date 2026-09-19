import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SessionScreen } from '../src/screens/SessionScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { AdaptiveShell } from '../src/navigation/AdaptiveShell';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { workspaceStore } from '../src/zeron/state/workspaceStore';

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

const count = (root: TestRenderer.ReactTestInstance, testID: string): number =>
  root.findAll(n => n.props.testID === testID).length;

beforeEach(() => {
  uiPrefsStore.setState({
    newThreadComposerBackground: {
      uri: 'file:///docs/new-thread-backgrounds/x.png',
      name: 'sunset.png',
    },
    newThreadBackgroundEffect: 'none',
  });
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
});

test('shell wallpaper sits behind home and the detail column', async () => {
  const mounted = await render(<AdaptiveShell requestedChat={null} />);
  expect(count(mounted.root, 'new-thread-background')).toBeGreaterThan(0);
  expect(count(mounted.root, 'session-background-blur')).toBeGreaterThan(0);
  expect(count(mounted.root, 'chat-background-blur')).toBe(0);
});

test('home list mounts the threads blur when artwork is set', async () => {
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  expect(count(mounted.root, 'session-background-blur')).toBeGreaterThan(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBeGreaterThan(0);
});

test('compose session stays sharp: chrome fade, no list or chat blur', async () => {
  const mounted = await render(<SessionScreen onBack={() => {}} />);
  expect(count(mounted.root, 'new-thread-background')).toBe(0);
  expect(count(mounted.root, 'chat-background-blur')).toBe(0);
  expect(count(mounted.root, 'session-background-blur')).toBe(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBeGreaterThan(0);
});

test('active session keeps the chrome fade and adds a column blur', async () => {
  workspaceStore.setState({
    chats: [
      {
        id: 'c1',
        deviceId: 'host1',
        archived: false,
        createdAt: Date.now(),
        title: 'Live thread',
      },
    ],
  });
  const mounted = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  expect(count(mounted.root, 'new-thread-background')).toBe(0);
  expect(count(mounted.root, 'chat-background-blur')).toBeGreaterThan(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBeGreaterThan(0);
});

test('no artwork means no wallpaper or blur layers', async () => {
  uiPrefsStore.setState({
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
  });
  const mounted = await render(<AdaptiveShell requestedChat={null} />);
  expect(count(mounted.root, 'new-thread-background')).toBe(0);
  expect(count(mounted.root, 'session-background-blur')).toBe(0);
});
