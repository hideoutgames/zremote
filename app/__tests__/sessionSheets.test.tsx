import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ThreadDetailsSheet } from '../src/components/ThreadDetailsSheet';
import { SubagentsSheet } from '../src/components/SubagentsSheet';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { SessionScreen } from '../src/screens/SessionScreen';
import { SessionSheet } from '../src/components/SessionSheet';
import { FileDiff } from '../src/components/agentsKit/FileDiff';
import { parseUnified } from '../src/zeron/diff/parseUnified';
import { TerminalScreen } from '../src/screens/TerminalScreen';
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

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

const named = (root: TestRenderer.ReactTestInstance, name: string) =>
  root.findAll(n => n.props.name === name);

const byTestId = (root: TestRenderer.ReactTestInstance, id: string) =>
  root.findAll(n => n.props.testID === id && typeof n.type === 'string');

beforeEach(() => {
  act(() => {
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
});

const trees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  trees.push(tree!);
  return tree!;
};

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount();
    trees.length = 0;
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
  expect(byTestId(tree.root, 'TrueSheet')[0].props.detents).toEqual([0.75, 1]);
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
  act(() => {
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
  });
  const opened: PrBadgeModel[] = [];
  const tree = await render(
    <HistoryScreen chatId="c1" onOpenPr={b => opened.push(b)} />,
  );
  expect(texts(tree.root)).toContain('Session sheets');
  const row = tree.root.findAll(
    n =>
      typeof n.props.onPress === 'function' &&
      n.props.accessibilityLabel === '#9 Session sheets, Open',
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

test('history empty copy is short', async () => {
  const tree = await render(<HistoryScreen chatId="c1" />);
  expect(texts(tree.root)).toContain('No Pull Requests');
});

test('session sheet uses a compact title and optional full detent', async () => {
  const listed = await render(
    <SessionSheet title="History" fill onDismiss={() => {}}>
      <Text>body</Text>
    </SessionSheet>,
  );
  expect(texts(listed.root)).toContain('History');
  expect(byTestId(listed.root, 'TrueSheet')[0].props.initialDetentIndex).toBe(
    0,
  );

  const term = await render(
    <SessionSheet fill initialDetentIndex={1} onDismiss={() => {}}>
      <Text>term</Text>
    </SessionSheet>,
  );
  expect(byTestId(term.root, 'TrueSheet')[0].props.initialDetentIndex).toBe(1);
  expect(texts(term.root)).not.toContain('Terminal');
});

test('FileDiff omits raw @@ hunk headers', async () => {
  const patch = [
    'diff --git a/f.ts b/f.ts',
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1,2 +1,2 @@ fn main',
    '-old',
    '+new',
  ].join('\n');
  const [file] = parseUnified(patch);
  const tree = await render(<FileDiff file={file} />);
  const labels = texts(tree.root);
  expect(labels.some(s => s.includes('@@'))).toBe(false);
  expect(labels).toContain('fn main');
  expect(labels).toContain('+');
  expect(labels).toContain('new');
});

test('TerminalScreen has no TTL copy', async () => {
  const tree = await render(<TerminalScreen chatId="c1" />);
  expect(texts(tree.root).join(' ')).not.toContain('30 minutes');
});
