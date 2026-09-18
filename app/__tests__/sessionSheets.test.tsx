import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThreadDetailsSheet } from '../src/components/ThreadDetailsSheet';
import { SubagentsSheet } from '../src/components/SubagentsSheet';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { SessionScreen } from '../src/screens/SessionScreen';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { getSessionStore } from '../src/zeron/state/sessionStores';
import {
  changeRequestStore,
  setChangeRequestForChat,
} from '../src/zeron/state/changeRequestStore';
import type { Chat, DeviceRow } from '../src/zeron/protocol/types';
import type { PrBadgeModel } from '../src/components/prBadge';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const chat: Chat = {
  id: 'c1',
  deviceId: 'h1',
  title: 'Demo thread',
  archived: false,
  createdAt: 1_700_000_000_000,
};

const device: DeviceRow = {
  id: 'h1',
  name: 'workstation',
  platform: 'macos',
  capabilities: [],
  version: '0.2.72',
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
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

const named = (root: TestRenderer.ReactTestInstance, name: string) =>
  root.findAll(n => n.props.name === name);

const byTestId = (root: TestRenderer.ReactTestInstance, id: string) =>
  root.findAll(n => n.props.testID === id);

beforeEach(() => {
  workspaceStore.setState({
    devices: [device],
    spaces: [],
    chats: [chat],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
  changeRequestStore.setState({ byChat: {}, diffByChat: {} });
  getSessionStore('c1').setState({
    entries: [],
    commands: [],
    queue: [],
    meta: {},
    pendingSends: [],
    failedSends: [],
    unsyncedCommandIds: [],
    room: 'idle',
    queueActionsPending: new Set(),
  });
});

test('view details has no x close button and uses the session sheet', async () => {
  const tree = await render(
    <ThreadDetailsSheet
      chat={chat}
      host={device}
      modelLabel="Codex · gpt-5"
      onDismiss={() => {}}
      onRename={() => {}}
    />,
  );
  expect(named(tree.root, 'xmark')).toHaveLength(0);
  expect(byTestId(tree.root, 'session-sheet')).toHaveLength(1);
  expect(tree.root.findByProps({ testID: 'TrueSheet' }).props.detents).toEqual([
    0.75, 1,
  ]);
  expect(texts(tree.root)).toContain('Demo thread');
});

test('sub-agents has no x close button', async () => {
  const tree = await render(
    <SubagentsSheet entries={[]} onDismiss={() => {}} />,
  );
  expect(named(tree.root, 'xmark')).toHaveLength(0);
  expect(byTestId(tree.root, 'session-sheet')).toHaveLength(1);
});

test('history lists the checkout PR and opens it on press', async () => {
  setChangeRequestForChat('c1', {
    checkoutId: 'ck',
    deviceId: 'h1',
    cwd: '/repo',
    branch: 'feat',
    changeRequest: {
      provider: 'github',
      number: 9,
      title: 'Session sheets',
      url: 'https://github.com/hideoutgames/zremote/pull/9',
      state: 'open',
      baseRef: 'main',
      headRef: 'feat',
    },
    updatedAt: '2026-09-18T00:00:00Z',
  });
  const opened: PrBadgeModel[] = [];
  const tree = await render(
    <HistoryScreen chatId="c1" onOpenPr={b => opened.push(b)} />,
  );
  expect(texts(tree.root)).toContain('Session sheets');
  const row = tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === '#9 Session sheets',
  )[0];
  expect(row).toBeTruthy();
  act(() => row.props.onPress());
  expect(opened).toHaveLength(1);
  expect(opened[0].number).toBe(9);
});

test('session overflow has History/Files/Terminal and not Changes/Previews', async () => {
  const tree = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  const labels = texts(tree.root);
  expect(labels).toContain('History');
  expect(labels).toContain('Files');
  expect(labels).toContain('Terminal');
  expect(labels).not.toContain('Changes');
  expect(labels).not.toContain('Previews');
  expect(byTestId(tree.root, 'session-sheet')).toHaveLength(0);
});
