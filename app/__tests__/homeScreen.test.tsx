// HomeScreen rows: large title, status subtitle, pinned section, unseen bold —
// driven entirely by a seeded workspaceStore.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { BrandMark } from '../src/components/BrandMark';
import * as Theme from '../src/theme';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import {
  changeRequestStore,
  setChangeRequestForChat,
  setCheckoutDiffForChat,
} from '../src/zeron/state/changeRequestStore';
import { toggleChatPinned, uiPrefsStore } from '../src/zeron/state/uiPrefs';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import type { Chat, DeviceRow } from '../src/zeron/protocol/types';

const device: DeviceRow = {
  id: 'host1',
  name: 'workstation',
  platform: 'macos',
  capabilities: [],
  version: '0.2.72',
};

const chat = (over: Partial<Chat>): Chat => ({
  id: 'c1',
  deviceId: 'host1',
  archived: false,
  createdAt: Date.now() - 60_000,
  ...over,
});

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

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat() : [c];
  });

const flattenText = (c: unknown): string => {
  if (c == null || typeof c === 'boolean') return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  if (typeof c === 'object' && c !== null && 'props' in c) {
    return flattenText((c as { props: { children?: unknown } }).props.children);
  }
  return '';
};

const statusOf = (root: TestRenderer.ReactTestInstance, id: string): string => {
  const node = root.findAll(
    n => n.props.testID === `thread-status-${id}` && typeof n.type === 'string',
  )[0];
  return flattenText(node?.props.children);
};

const searchInput = (
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance =>
  root.findAll(
    n =>
      n.props.testID === 'home-search-input' &&
      typeof n.props.onChangeText === 'function',
  )[0];

const bodyText = (root: TestRenderer.ReactTestInstance, id: string): string => {
  const body = root.findAll(
    n => n.props.testID === `thread-body-${id}` && typeof n.type === 'string',
  )[0];
  return body
    .findAllByType(Text)
    .map(n => flattenText(n.props.children))
    .join(' ');
};

jest.useFakeTimers();

beforeEach(() => {
  workspaceStore.setState({
    devices: [device],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
  changeRequestStore.setState({ byChat: {}, diffByChat: {} });
  uiPrefsStore.setState({ pinnedChatIds: [] });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  jest.clearAllTimers();
});

test('renders Threads title, row titles, and a time subtitle — not project · host', async () => {
  workspaceStore.setState({
    spaces: [
      {
        id: 's1',
        deviceId: 'host1',
        path: '/repo',
        gitDetected: true,
        createdAt: 0,
      },
    ],
    chats: [
      chat({
        title: 'Fix the flaky test',
        spaceId: 's1',
        cwd: '/code/zremote',
        branch: 'main',
        lastMessagePreview: 'should not render in the row',
      }),
      chat({ id: 'c2', title: 'Write docs' }),
    ],
    presence: { host1: Date.now() },
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(mounted.root);
  expect(found).toContain('Threads');
  expect(found).toContain('Fix the flaky test');
  expect(found).toContain('Write docs');
  const row = bodyText(mounted.root, 'c1');
  expect(row).toContain('Fix the flaky test');
  expect(row).not.toContain('zremote @ main');
  expect(row).not.toContain('workstation');
  expect(row).not.toContain('should not render in the row');
  expect(statusOf(mounted.root, 'c1')).toBe('1m');
  const trigger = mounted.root.findAll(
    n => n.props.testID === 'spaceFilter',
  )[0];
  expect(trigger).toBeDefined();
  expect(trigger.props.accessibilityLabel).toBe('All spaces');
  const search = searchInput(mounted.root);
  expect(search).toBeDefined();
  expect(search.props.accessibilityLabel).toBe('Search sessions');
});

test('archived chats stay off the overview; connection pill shows offline', async () => {
  workspaceStore.setState({
    chats: [
      chat({ title: 'Live chat' }),
      chat({ id: 'c2', title: 'Old chat', archived: true }),
    ],
    connection: 'disconnected',
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(mounted.root);
  expect(found).toContain('Live chat');
  // archived row exists only inside the collapsed shelf — the shelf title is
  // present, the row is hidden until expanded.
  expect(found).not.toContain('Old chat');
  expect(found).toContain('Offline');
});

test('unseen chat renders bold (higher fontWeight)', async () => {
  workspaceStore.setState({
    chats: [
      chat({
        title: 'Unseen',
        lastMessageAt: Date.now() - 1000,
        lastSeenAt: Date.now() - 60_000,
      }),
    ],
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const titleNode = mounted.root
    .findAllByType(Text)
    .find(n => n.props.children === 'Unseen');
  expect(titleNode).toBeDefined();
  const style = Array.isArray(titleNode!.props.style)
    ? titleNode!.props.style.flat()
    : [titleNode!.props.style];
  expect(style.some(s => s?.fontWeight === '700')).toBe(true);
});

test('PR status follows checkout change-request state', async () => {
  workspaceStore.setState({
    chats: [
      chat({ id: 'open', title: 'Open PR' }),
      chat({ id: 'draft', title: 'Draft PR' }),
      chat({ id: 'merged', title: 'Merged PR' }),
      chat({ id: 'none', title: 'No PR' }),
    ],
  });
  const cr = (
    id: string,
    state: 'open' | 'merged' | 'closed',
    draft?: boolean,
  ) =>
    setChangeRequestForChat(id, {
      checkoutId: id,
      deviceId: 'host1',
      cwd: '/repo',
      branch: 'main',
      changeRequest: {
        provider: 'github',
        number: 1,
        title: id,
        url: 'https://example.com/1',
        state,
        baseRef: 'main',
        headRef: 'feat',
        ...(draft === true ? { draft: true } : {}),
      },
      updatedAt: 'now',
    });
  cr('open', 'open');
  cr('draft', 'open', true);
  cr('merged', 'merged');
  setCheckoutDiffForChat('merged', {
    checkoutId: 'merged',
    deviceId: 'host1',
    cwd: '/repo',
    patch: '',
    files: [],
    additions: 12,
    deletions: 3,
    truncated: false,
    checksum: 'x',
    updatedAt: 'now',
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  expect(statusOf(mounted.root, 'open')).toBe('Open');
  expect(statusOf(mounted.root, 'draft')).toBe('Draft');
  expect(statusOf(mounted.root, 'merged')).toBe('Merged · +12 \u22123');
  expect(statusOf(mounted.root, 'none')).toBe('1m');
});

test('working threads show Working; idle threads stay full color', async () => {
  workspaceStore.setState({
    chats: [
      chat({ id: 'live', title: 'Live agent', lastMessageAt: Date.now() }),
      chat({
        id: 'idle',
        title: 'Idle thread',
        lastMessageAt: Date.now() - 10,
      }),
    ],
    sessions: {
      live: {
        chatId: 'live',
        deviceId: 'host1',
        status: 'working',
        updatedAt: Date.now(),
      },
    },
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  expect(statusOf(mounted.root, 'live')).toBe('Working');
  const body = mounted.root.findAll(
    n => n.props.testID === 'thread-body-idle' && typeof n.type === 'string',
  )[0];
  const style = Array.isArray(body.props.style)
    ? body.props.style.flat()
    : [body.props.style];
  expect(style.find(s => s && typeof s.opacity === 'number')).toBeUndefined();
});

test('pinned chats render under a Pinned header first', async () => {
  workspaceStore.setState({
    chats: [
      chat({
        id: 'recent',
        title: 'Recent thread',
        lastMessageAt: Date.now(),
      }),
      chat({
        id: 'pinned',
        title: 'Pinned thread',
        lastMessageAt: Date.now() - 60_000,
      }),
    ],
  });
  uiPrefsStore.setState({ pinnedChatIds: ['pinned'] });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(mounted.root);
  expect(found).toContain('Pinned');
  const pinnedIdx = found.indexOf('Pinned');
  const pinnedTitle = found.indexOf('Pinned thread');
  const recentTitle = found.indexOf('Recent thread');
  expect(pinnedIdx).toBeGreaterThan(-1);
  expect(pinnedTitle).toBeGreaterThan(pinnedIdx);
  expect(recentTitle).toBeGreaterThan(pinnedTitle);
});

test('pinned chats sit in a Pinned section in prefs order', async () => {
  workspaceStore.setState({
    chats: [
      chat({
        id: 'older',
        title: 'Older thread',
        lastMessageAt: Date.now() - 10_000,
      }),
      chat({
        id: 'newer',
        title: 'Newer thread',
        lastMessageAt: Date.now(),
      }),
    ],
  });
  await act(async () => {
    toggleChatPinned('older');
    toggleChatPinned('newer');
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(mounted.root);
  expect(found).toContain('Pinned');
  expect(found).toContain('Threads');
  expect(found).toContain('Unpin');
  const pinOlder = mounted.root.findAll(
    n => n.props.testID === 'thread-pin-older' && typeof n.type === 'string',
  );
  const pinNewer = mounted.root.findAll(
    n => n.props.testID === 'thread-pin-newer' && typeof n.type === 'string',
  );
  expect(pinOlder).toHaveLength(1);
  expect(pinNewer).toHaveLength(1);
  // Most recently pinned first (newer was pinned after older).
  expect(found.indexOf('Newer thread')).toBeLessThan(
    found.indexOf('Older thread'),
  );
});

test('pinning every thread does not show the empty state', async () => {
  workspaceStore.setState({
    chats: [chat({ title: 'Only thread' })],
  });
  await act(async () => {
    toggleChatPinned('c1');
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(mounted.root);
  expect(found).toContain('Pinned');
  expect(found).toContain('Only thread');
  expect(found).not.toContain('No sessions yet');
});

test('search is an always-visible field and hides the composer while focused', async () => {
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const search = searchInput(mounted.root);
  expect(search).toBeDefined();
  expect(
    mounted.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBeGreaterThan(0);
  await act(async () => {
    search.props.onFocus();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'compose-composer'),
  ).toHaveLength(0);
  await act(async () => {
    search.props.onBlur();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBeGreaterThan(0);
});

test('sidebar New thread hides while search is focused', async () => {
  const mounted = await render(
    <HomeScreen
      variant="sidebar"
      onOpenSession={() => {}}
      onOpenSettings={() => {}}
      onCompose={() => {}}
    />,
  );
  expect(
    mounted.root.findAll(n => n.props.testID === 'home-new-thread').length,
  ).toBeGreaterThan(0);
  const search = searchInput(mounted.root);
  await act(async () => {
    search.props.onFocus();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'home-new-thread'),
  ).toHaveLength(0);
});

test('thread harness marks tint with theme text so they stay visible in dark mode', async () => {
  const themeSpy = jest
    .spyOn(Theme, 'useTheme')
    .mockReturnValue(Theme.darkTheme);
  workspaceStore.setState({
    chats: [
      chat({
        id: 'with-mark',
        title: 'Codex thread',
        config: { harness: 'codex', modelOptions: {} },
      }),
      chat({ id: 'no-mark', title: 'Bare thread' }),
    ],
  });
  try {
    const mounted = await render(
      <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
    );
    const body = mounted.root.findAll(
      n =>
        n.props.testID === 'thread-body-with-mark' &&
        typeof n.type === 'string',
    )[0];
    const marks = body.findAllByType(BrandMark);
    expect(marks).toHaveLength(1);
    expect(marks[0].props.svg).toContain(Theme.darkTheme.text);
    expect(marks[0].props.svg).not.toContain('currentColor');
    const bare = mounted.root.findAll(
      n =>
        n.props.testID === 'thread-body-no-mark' && typeof n.type === 'string',
    )[0];
    expect(bare.findAllByType(BrandMark)).toHaveLength(0);
  } finally {
    themeSpy.mockRestore();
  }
});
