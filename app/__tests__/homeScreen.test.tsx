// HomeScreen rows: title, project · host subtitle, PR dot, unseen bold —
// driven entirely by a seeded workspaceStore.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import {
  changeRequestStore,
  setChangeRequestForChat,
} from '../src/zeron/state/changeRequestStore';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import type { Chat, DeviceRow } from '../src/zeron/protocol/types';
import { toggleChatPinned, uiPrefsStore } from '../src/zeron/state/uiPrefs';

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

test('renders Threads header, title, and project · host subtitle', async () => {
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
  expect(
    found.some(
      s =>
        typeof s === 'string' &&
        s.includes('zremote @ main') &&
        s.includes('workstation') &&
        s.indexOf('zremote @ main') < s.indexOf('workstation'),
    ),
  ).toBe(true);
  const trigger = mounted.root.findAll(
    n => n.props.testID === 'spaceFilter',
  )[0];
  expect(trigger).toBeDefined();
  expect(trigger.props.accessibilityLabel).toBe('All spaces');
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

test('PR dots follow checkout change-request state', async () => {
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
  const mounted = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const hostId = (id: string, tone: string) =>
    mounted.root.findAll(
      n =>
        n.props.testID === `pr-dot-${id}-${tone}` && typeof n.type === 'string',
    );
  expect(hostId('open', 'open')).toHaveLength(1);
  expect(hostId('draft', 'draft')).toHaveLength(1);
  expect(hostId('merged', 'merged')).toHaveLength(1);
  expect(hostId('none', 'none')).toHaveLength(1);
});

test('inactive threads are dimmed; working threads stay full color', async () => {
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
  const bodyStyle = (id: string) => {
    const body = mounted.root.findAll(
      n => n.props.testID === `thread-body-${id}` && typeof n.type === 'string',
    )[0];
    const style = Array.isArray(body.props.style)
      ? body.props.style.flat()
      : [body.props.style];
    return style.find(s => s && typeof s.opacity === 'number')?.opacity;
  };
  expect(bodyStyle('live')).toBeUndefined();
  expect(bodyStyle('idle')).toBe(0.55);
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
