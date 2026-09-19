// HomeScreen rows: compact Threads title, status subtitle, pinned section,
// unseen medium weight — driven entirely by a seeded workspaceStore.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { BrandMark } from '../src/components/BrandMark';
import { TOP_CHROME_FADE_BAND } from '../src/components/TopChromeFade';
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
  const node = root.findAll(n => n.props.testID === `thread-status-${id}`)[0];
  const shimmer = node?.findAll(n => typeof n.props.text === 'string')[0];
  if (shimmer !== undefined) return shimmer.props.text;
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
  const homeTitle = mounted.root.findAll(
    n => n.props.testID === 'home-title',
  )[0];
  expect(homeTitle).toBeDefined();
  const homeTitleStyle = Array.isArray(homeTitle.props.style)
    ? homeTitle.props.style.flat()
    : [homeTitle.props.style];
  expect(homeTitleStyle.some(s => s?.fontWeight === '500')).toBe(true);
  expect(homeTitleStyle.some(s => s?.fontSize === 20)).toBe(true);
  const seenTitle = mounted.root
    .findAllByType(Text)
    .find(n => n.props.children === 'Fix the flaky test');
  expect(seenTitle).toBeDefined();
  const seenStyle = Array.isArray(seenTitle!.props.style)
    ? seenTitle!.props.style.flat()
    : [seenTitle!.props.style];
  expect(seenStyle.some(s => s?.fontWeight === '400')).toBe(true);
  expect(
    seenStyle.some(s => s?.fontWeight === '600' || s?.fontWeight === '700'),
  ).toBe(false);
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
  const fade = mounted.root.findAll(
    n => n.props.testID === 'top-chrome-fade',
  )[0];
  expect(fade).toBeDefined();
  const fadeStyle = Array.isArray(fade.props.style)
    ? fade.props.style.flat()
    : [fade.props.style];
  const fadeHeight = fadeStyle.find(s => s?.height != null)?.height as number;
  const list = mounted.root.findByType(FlatList);
  const listPad = Array.isArray(list.props.contentContainerStyle)
    ? list.props.contentContainerStyle.flat()
    : [list.props.contentContainerStyle];
  const paddingTop = listPad.find(s => s?.paddingTop != null)?.paddingTop as
    | number
    | undefined;
  expect(paddingTop).toBeGreaterThan(fadeHeight - TOP_CHROME_FADE_BAND);
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
  const archivedHeader = mounted.root.findAll(
    n => n.props.testID === 'home-archived-header',
  )[0];
  expect(archivedHeader).toBeDefined();
  const headerStyle = Array.isArray(archivedHeader.props.style)
    ? archivedHeader.props.style.flat()
    : [archivedHeader.props.style];
  expect(headerStyle.some(s => s?.alignItems === 'center')).toBe(true);
  const archivedLabel = archivedHeader.findAllByType(Text)[0];
  const labelStyle = Array.isArray(archivedLabel.props.style)
    ? archivedLabel.props.style.flat()
    : [archivedLabel.props.style];
  expect(labelStyle.some(s => s?.paddingTop === 16)).toBe(false);
  expect(labelStyle.some(s => s?.paddingHorizontal === 20)).toBe(false);
  expect(labelStyle.some(s => s?.lineHeight === 20)).toBe(true);
});

test('unseen chat renders medium weight (higher than regular titles)', async () => {
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
  expect(style.some(s => s?.fontWeight === '500')).toBe(true);
  expect(
    style.some(s => s?.fontWeight === '700' || s?.fontWeight === '600'),
  ).toBe(false);
});

const statusNode = (
  root: TestRenderer.ReactTestInstance,
  id: string,
): TestRenderer.ReactTestInstance =>
  root.findAll(n => n.props.testID === `thread-status-${id}`)[0];

const prMarksOf = (root: TestRenderer.ReactTestInstance, id: string) =>
  statusNode(root, id).findAllByType(BrandMark);

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
  expect(statusOf(mounted.root, 'merged')).toBe('Merged · +12 -3');
  expect(statusOf(mounted.root, 'none')).toBe('1m');
  expect(prMarksOf(mounted.root, 'open')).toHaveLength(1);
  expect(prMarksOf(mounted.root, 'draft')).toHaveLength(1);
  expect(prMarksOf(mounted.root, 'merged')).toHaveLength(1);
  expect(prMarksOf(mounted.root, 'none')).toHaveLength(0);
  const mergedSvg = prMarksOf(mounted.root, 'merged')[0].props.svg as string;
  expect(
    mergedSvg.includes(Theme.darkTheme.prMerged) ||
      mergedSvg.includes(Theme.lightTheme.prMerged),
  ).toBe(true);
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
        startedAt: Date.now() - 12_000,
        updatedAt: Date.now(),
      },
    },
  });
  setChangeRequestForChat('live', {
    checkoutId: 'live',
    deviceId: 'host1',
    cwd: '/repo',
    branch: 'main',
    changeRequest: {
      provider: 'github',
      number: 9,
      title: 'Live PR',
      url: 'https://example.com/9',
      state: 'open',
      baseRef: 'main',
      headRef: 'feat',
    },
    updatedAt: 'now',
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  expect(statusOf(mounted.root, 'live')).toBe('Working');
  expect(prMarksOf(mounted.root, 'live')).toHaveLength(0);
  expect(
    mounted.root.findAll(n => n.props.testID === 'thread-elapsed-live')[0]
      ?.props.children,
  ).toBe('12s');
  const liveTitle = mounted.root
    .findAllByType(Text)
    .find(n => n.props.children === 'Live agent');
  expect(liveTitle).toBeDefined();
  const liveStyle = Array.isArray(liveTitle!.props.style)
    ? liveTitle!.props.style.flat()
    : [liveTitle!.props.style];
  expect(
    liveStyle.some(s => s?.color === '#0A84FF' || s?.color === '#007AFF'),
  ).toBe(true);
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
  const pinnedSection = mounted.root.findAll(
    n => n.props.testID === 'home-pinned-section',
  )[0];
  expect(pinnedSection).toBeDefined();
  const pinnedStyle = Array.isArray(pinnedSection.props.style)
    ? pinnedSection.props.style.flat()
    : [pinnedSection.props.style];
  expect(pinnedStyle.some(s => s?.paddingBottom === 12)).toBe(true);
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

test('search is an always-visible field and hides New thread while focused', async () => {
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const search = searchInput(mounted.root);
  expect(search).toBeDefined();
  expect(
    mounted.root.findAll(n => n.props.testID === 'home-new-thread').length,
  ).toBeGreaterThan(0);
  expect(
    mounted.root.findAll(n => n.props.testID === 'compose-composer'),
  ).toHaveLength(0);
  expect(texts(mounted.root)).not.toContain('New thread');
  await act(async () => {
    search.props.onFocus();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'home-new-thread'),
  ).toHaveLength(0);
  await act(async () => {
    search.props.onBlur();
  });
  expect(
    mounted.root.findAll(n => n.props.testID === 'home-new-thread').length,
  ).toBeGreaterThan(0);
});

test('New thread is a circular icon control with no visible text', async () => {
  const mounted = await render(
    <HomeScreen
      onOpenSession={() => {}}
      onOpenSettings={() => {}}
      onCompose={() => {}}
    />,
  );
  const btn = mounted.root.findAll(
    n => n.props.testID === 'home-new-thread',
  )[0];
  expect(btn).toBeDefined();
  expect(btn.props.accessibilityLabel).toBe('New thread');
  const icons = btn.findAll(n => n.props.symbolName === 'square.and.pencil');
  expect(icons.length).toBeGreaterThan(0);
  expect(texts(mounted.root)).not.toContain('New thread');
});

test('working elapsed stays in hours past a day', async () => {
  const now = Date.now();
  workspaceStore.setState({
    chats: [chat({ id: 'long', title: 'Long run', lastMessageAt: now })],
    sessions: {
      long: {
        chatId: 'long',
        deviceId: 'host1',
        status: 'working',
        startedAt: now - 47 * 3_600_000,
        updatedAt: now,
      },
    },
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  expect(
    mounted.root.findAll(n => n.props.testID === 'thread-elapsed-long')[0]
      ?.props.children,
  ).toBe('47h');
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

test('long-press keeps row chrome until the context menu closes', async () => {
  workspaceStore.setState({
    chats: [chat({ title: 'Fix the flaky test' })],
  });
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const root = mounted.root.findAll(n => n.props.testID === 'ContextRoot')[0];
  expect(typeof root.props.onOpenChange).toBe('function');
  await act(async () => {
    root.props.onOpenChange(true);
  });
  const row = mounted.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes('Fix the flaky test'),
  )[0];
  const openStyle = Array.isArray(row.props.style)
    ? row.props.style.flat()
    : [row.props.style];
  expect(openStyle.some(s => s && s.shadowOpacity === 0.22)).toBe(true);
  await act(async () => {
    root.props.onOpenChange(false);
  });
  const closedStyle = Array.isArray(row.props.style)
    ? row.props.style.flat()
    : [row.props.style];
  expect(closedStyle.some(s => s && s.shadowOpacity === 0.22)).toBe(false);
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
