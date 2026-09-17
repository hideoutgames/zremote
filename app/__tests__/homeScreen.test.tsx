// HomeScreen rows: title, host subtitle, status dot, unseen bold — driven
// entirely by a seeded workspaceStore.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { HomeScreen } from '../src/screens/HomeScreen';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
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

const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
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
});

test('renders overview rows with title and host subtitle', async () => {
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
      chat({ title: 'Fix the flaky test', spaceId: 's1' }),
      chat({ id: 'c2', title: 'Write docs' }),
    ],
    presence: { host1: Date.now() },
  });
  const tree = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(tree.root);
  expect(found).toContain('Fix the flaky test');
  expect(found).toContain('Write docs');
  expect(
    found.some(s => typeof s === 'string' && s.includes('workstation')),
  ).toBe(true);
});

test('archived chats stay off the overview; connection pill shows offline', async () => {
  workspaceStore.setState({
    chats: [
      chat({ title: 'Live chat' }),
      chat({ id: 'c2', title: 'Old chat', archived: true }),
    ],
    connection: 'disconnected',
  });
  const tree = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const found = texts(tree.root);
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
  const tree = await render(
    <HomeScreen onOpenSession={() => {}} onOpenSettings={() => {}} />,
  );
  const titleNode = tree.root
    .findAllByType(Text)
    .find(n => n.props.children === 'Unseen');
  expect(titleNode).toBeDefined();
  const style = Array.isArray(titleNode!.props.style)
    ? titleNode!.props.style.flat()
    : [titleNode!.props.style];
  expect(style.some(s => s?.fontWeight === '700')).toBe(true);
});
