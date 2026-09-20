import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { SessionScreen } from '../src/screens/SessionScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { AdaptiveShell } from '../src/navigation/AdaptiveShell';
import { FadeBlur } from '../src/components/FadeBlur';
import {
  COMPACT_THREADS_INTENSITY,
  REGULAR_THREADS_INTENSITY,
  wallpaperBlurFor,
} from '../src/components/SessionBackgroundBlur';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { setWallpaperContrast } from '../src/zeron/state/wallpaperContrast';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import * as Theme from '../src/theme';

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
  (useKeyboardState as jest.Mock).mockImplementation(
    (selector: (s: { height: number }) => unknown) => selector({ height: 0 }),
  );
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
  expect(count(mounted.root, 'content-edge-mask')).toBeGreaterThan(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBe(0);
});

const zIndexOf = (node: TestRenderer.ReactTestInstance): number => {
  const style = Array.isArray(node.props.style)
    ? node.props.style.flat()
    : [node.props.style];
  const z = style.find(s => s != null && typeof s.zIndex === 'number')?.zIndex;
  return typeof z === 'number' ? z : 0;
};

test('compose session stays sharp: no overlay fade, no list or chat blur', async () => {
  const mounted = await render(<SessionScreen onBack={() => {}} />);
  expect(count(mounted.root, 'new-thread-background')).toBe(0);
  expect(count(mounted.root, 'chat-background-blur')).toBe(0);
  expect(count(mounted.root, 'session-background-blur')).toBe(0);
  expect(count(mounted.root, 'composer-surround-blur')).toBe(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBe(0);
  const center = mounted.root.findByProps({ testID: 'compose-center' });
  const dismiss = mounted.root.findByProps({ testID: 'compose-dismiss' });
  expect(center.props.pointerEvents).toBe('box-none');
  expect(center.props.onStartShouldSetResponder).toBeUndefined();
  expect(typeof dismiss.props.onStartShouldSetResponder).toBe('function');
  expect(zIndexOf(center)).toBeGreaterThan(zIndexOf(dismiss));
  const centerStyle = Array.isArray(center.props.style)
    ? center.props.style.flat()
    : [center.props.style];
  expect(centerStyle.some(s => s?.alignItems === 'center')).toBe(true);
});

test('active session keeps a content mask and no top overlay fade', async () => {
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
  expect(count(mounted.root, 'chat-background-blur')).toBe(0);
  expect(count(mounted.root, 'content-edge-mask')).toBeGreaterThan(0);
  expect(count(mounted.root, 'top-chrome-fade')).toBe(0);
  expect(count(mounted.root, 'bottom-chrome-fade')).toBe(0);
});

test('composer dim is absent until the keyboard is visible', async () => {
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
  expect(count(mounted.root, 'composer-focus-dim')).toBe(0);
});

test('focused composer dim mounts without a bottom chrome fade overlay', async () => {
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
  const mocked = useKeyboardState as jest.Mock;
  mocked.mockImplementation((selector: (s: { height: number }) => unknown) =>
    selector({ height: 336 }),
  );
  const mounted = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  const input = mounted.root.findByType(TextInput);
  await act(async () => {
    input.props.onFocus();
  });
  expect(count(mounted.root, 'composer-focus-dim')).toBeGreaterThan(0);
  expect(count(mounted.root, 'bottom-chrome-fade')).toBe(0);
  mocked.mockImplementation((selector: (s: { height: number }) => unknown) =>
    selector({ height: 0 }),
  );
});

test('iPad compose composer is a centered max-width column', async () => {
  const mounted = await render(
    <SessionScreen onBack={() => {}} composerMaxWidth={560} />,
  );
  const center = mounted.root.findByProps({ testID: 'compose-center' });
  const centerStyle = StyleSheet.flatten(center.props.style);
  expect(centerStyle.alignItems).toBe('center');
  const composer = mounted.root.findByProps({ testID: 'compose-composer' });
  const composerStyle = StyleSheet.flatten(composer.props.style);
  expect(composerStyle.width).toBe('100%');
  expect(composerStyle.maxWidth).toBe(560);
  expect(composerStyle.alignSelf).not.toBe('center');
});

test('iPad session composer parent centers a max-width column', async () => {
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
  const mounted = await render(
    <SessionScreen chatId="c1" onBack={() => {}} composerMaxWidth={560} />,
  );
  const wrap = mounted.root.findByProps({ testID: 'session-composer' });
  const wrapStyle = StyleSheet.flatten(wrap.props.style);
  expect(wrapStyle.alignItems).toBe('center');
  const inner = mounted.root.findByProps({ testID: 'session-composer-column' });
  const innerStyle = StyleSheet.flatten(inner.props.style);
  expect(innerStyle.width).toBe('100%');
  expect(innerStyle.maxWidth).toBe(560);
  expect(innerStyle.alignSelf).not.toBe('center');
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
  expect(wallpaperBlurFor(390)).toEqual({
    intensity: COMPACT_THREADS_INTENSITY,
    fade: 'none',
  });
  expect(COMPACT_THREADS_INTENSITY).toBe(120);
  expect(REGULAR_THREADS_INTENSITY).toBe(90);
  expect(wallpaperBlurFor(1024)).toEqual({
    intensity: REGULAR_THREADS_INTENSITY,
    fade: 'none',
  });
});

test('home list uses full-bleed regular blur at the 750pt test window', async () => {
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const blur = mounted.root.findAllByType(FadeBlur)[0];
  expect(blur.props.fade).toBe('none');
  expect(blur.props.tint).toBe('systemThinMaterialDark');
  expect(blur.props.intensity).toBe(REGULAR_THREADS_INTENSITY);
  expect(count(mounted.root, 'session-background-dim')).toBeGreaterThan(0);
  expect(count(mounted.root, 'bottom-chrome-fade')).toBe(0);
  expect(count(mounted.root, 'content-edge-mask')).toBeGreaterThan(0);
});

test('session chrome follows the content theme when wallpaper is set', async () => {
  const themeSpy = jest
    .spyOn(Theme, 'useTheme')
    .mockReturnValue(Theme.lightTheme);
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
  try {
    const mounted = await render(
      <SessionScreen chatId="c1" onBack={() => {}} />,
    );
    const back = mounted.root.findAll(
      n => n.props.name === 'chevron.left' && n.props.tintColor != null,
    )[0];
    expect(back.props.tintColor).toBe(Theme.lightTheme.text);
    const overflow = mounted.root.findAll(
      n => n.props.name === 'ellipsis' && n.props.tintColor != null,
    )[0];
    expect(overflow.props.tintColor).toBe(Theme.lightTheme.text);
    const glassTints = mounted.root.findAll(
      n => n.props.tint === 'systemThinMaterialLight',
    );
    expect(glassTints.length).toBeGreaterThan(0);
    expect(
      mounted.root.findAll(n => n.props.tint === 'systemThinMaterialDark'),
    ).toHaveLength(0);
    expect(
      mounted.root.findAll(n => {
        const c = n.props.children;
        return typeof c === 'string' && c.includes('Nothing here yet');
      }),
    ).toHaveLength(0);
    expect(mounted.root.findAllByType(Text).length).toBeGreaterThan(0);
  } finally {
    themeSpy.mockRestore();
  }
});
