import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { SessionScreen } from '../src/screens/SessionScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { AdaptiveShell } from '../src/navigation/AdaptiveShell';
import { FadeBlur } from '../src/components/FadeBlur';
import {
  COMPACT_WALLPAPER_BLUR,
  REGULAR_CHAT_COLUMN_EDGE,
  REGULAR_THREADS_INTENSITY,
  chatBlurMaxWidth,
  wallpaperBlurFor,
} from '../src/components/SessionBackgroundBlur';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { setWallpaperContrast } from '../src/zeron/state/wallpaperContrast';
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
  setWallpaperContrast(undefined, undefined);
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

const zIndexOf = (node: TestRenderer.ReactTestInstance): number => {
  const style = Array.isArray(node.props.style)
    ? node.props.style.flat()
    : [node.props.style];
  const z = style.find(s => s != null && typeof s.zIndex === 'number')?.zIndex;
  return typeof z === 'number' ? z : 0;
};

test('compose session stays sharp: chrome fade, no list or chat blur', async () => {
  const mounted = await render(<SessionScreen onBack={() => {}} />);
  expect(count(mounted.root, 'new-thread-background')).toBe(0);
  expect(count(mounted.root, 'chat-background-blur')).toBe(0);
  expect(count(mounted.root, 'session-background-blur')).toBe(0);
  expect(count(mounted.root, 'composer-surround-blur')).toBe(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBeGreaterThan(0);
  const fade = mounted.root.findByProps({ testID: 'top-chrome-fade' });
  const center = mounted.root.findByProps({ testID: 'compose-center' });
  const dismiss = mounted.root.findByProps({ testID: 'compose-dismiss' });
  expect(fade.props.pointerEvents).toBe('none');
  expect(center.props.pointerEvents).toBe('box-none');
  expect(center.props.onStartShouldSetResponder).toBeUndefined();
  expect(typeof dismiss.props.onStartShouldSetResponder).toBe('function');
  expect(zIndexOf(center)).toBeGreaterThan(zIndexOf(fade));
  expect(zIndexOf(center)).toBeGreaterThan(zIndexOf(dismiss));
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

test('focused composer dim sits above the top chrome fade', async () => {
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
  const input = mounted.root.findByType(TextInput);
  await act(async () => {
    input.props.onFocus();
  });
  const dim = mounted.root.findByProps({ testID: 'composer-focus-dim' });
  const fade = mounted.root.findByProps({ testID: 'top-chrome-fade' });
  expect(zIndexOf(dim)).toBeGreaterThan(zIndexOf(fade));
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

test('compact wallpaper blur is full-bleed; iPad sidebar is unmasked', () => {
  expect(wallpaperBlurFor(390, 'threads')).toEqual({
    intensity: COMPACT_WALLPAPER_BLUR,
    fade: 'none',
  });
  expect(wallpaperBlurFor(390, 'chat', false)).toEqual({
    intensity: COMPACT_WALLPAPER_BLUR,
    fade: 'none',
  });
  expect(wallpaperBlurFor(1024, 'threads')).toEqual({
    intensity: REGULAR_THREADS_INTENSITY,
    fade: 'none',
  });
  expect(wallpaperBlurFor(1024, 'chat', true).fadeHold).toBe(
    REGULAR_CHAT_COLUMN_EDGE,
  );
  expect(chatBlurMaxWidth(720)).toBeGreaterThan(720);
});

test('home list uses full-bleed regular blur at the 750pt test window', async () => {
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const blur = mounted.root.findAllByType(FadeBlur)[0];
  expect(blur.props.fade).toBe('none');
  expect(count(mounted.root, 'session-background-dim')).toBeGreaterThan(0);
});
