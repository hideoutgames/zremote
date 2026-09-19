import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
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
import type {
  Chat,
  DeviceRow,
  MessageEntry,
  MessagePart,
} from '../src/zeron/protocol/types';
import type { PrBadgeModel } from '../src/components/prBadge';
import { BrandMark } from '../src/components/BrandMark';
import { AppErrorBoundary } from '../src/app/AppErrorBoundary';
import { entryFrom } from '../src/zeron/doc/sessionDoc';
import { CHAT_WORKING, demoTranscripts } from '../src/demo/fixtures';

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

const spawn = (
  id: string,
  name: string,
  extra: Partial<Extract<MessagePart, { kind: 'tool' }>> & {
    input?: Record<string, unknown>;
    subagentStatus?: 'running' | 'done' | 'failed';
    resolved?: boolean;
  } = {},
): Extract<MessagePart, { kind: 'tool' }> => {
  const { input, subagentStatus, resolved, ...rest } = extra;
  return {
    kind: 'tool',
    id,
    call: {
      kind: 'unknown',
      name,
      ...(input !== undefined ? { input } : {}),
    },
    resolved: resolved ?? true,
    ...(subagentStatus !== undefined ? { subagentStatus } : {}),
    ...rest,
  };
};

const assistant = (parts: MessageEntry['parts']): MessageEntry => ({
  id: 'a1',
  role: 'assistant',
  parts,
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
});

const statusOf = (root: TestRenderer.ReactTestInstance, id: string) => {
  const node = root.findAll(n => n.props.testID === `subagent-status-${id}`)[0];
  if (node === undefined) {
    return { text: '', shimmer: false };
  }
  const shimmer = node.findAll(n => typeof n.props.text === 'string')[0];
  if (shimmer !== undefined) {
    return { text: shimmer.props.text as string, shimmer: true };
  }
  return { text: texts(node).join(''), shimmer: false };
};

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

test('running sub-agent status shimmers Working copy', async () => {
  const tree = await render(
    <SubagentsSheet
      entries={[
        assistant([
          spawn('done', 'Agent: Explore composer UI', {
            input: { subagent_type: 'Explore' },
            subagentStatus: 'done',
          }),
          spawn('run', 'Agent: Trace header styles', {
            input: { subagent_type: 'Explore' },
            subagentStatus: 'running',
            resolved: false,
          }),
        ]),
      ]}
      onDismiss={() => {}}
    />,
  );
  expect(statusOf(tree.root, 'run')).toEqual({
    text: 'Working · Explorer',
    shimmer: true,
  });
  expect(statusOf(tree.root, 'done')).toEqual({
    text: 'Done · Explorer',
    shimmer: false,
  });
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
  expect(tree.root.findAllByType(BrandMark).length).toBeGreaterThan(0);
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

test('session header subtitle ellipsizes instead of clipping', async () => {
  act(() => {
    workspaceStore.setState(s => ({
      ...s,
      chats: [
        {
          ...chat,
          cwd: '/very/long/path/to/the/current/worktree',
          branch: 'feature/extremely-long-branch-name-that-overflows',
        },
      ],
    }));
  });
  const tree = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  const subtitle = tree.root.findAll(
    n => n.props.testID === 'session-header-subtitle',
  )[0];
  expect(subtitle).toBeDefined();
  expect(subtitle.props.numberOfLines).toBe(1);
  expect(subtitle.props.ellipsizeMode).toBe('tail');
  const pill = tree.root.findAll(
    n => n.props.testID === 'session-title-pill',
  )[0];
  const pillStyle = Array.isArray(pill.props.style)
    ? pill.props.style.flat()
    : [pill.props.style];
  expect(pillStyle.some(s => s?.maxWidth === '100%')).toBe(true);
  expect(pillStyle.some(s => s?.flexShrink === 1)).toBe(true);
  expect(pillStyle.some(s => s?.overflow === 'hidden')).toBe(false);
});

test('compose session is a blank chat with the composer', async () => {
  const tree = await render(<SessionScreen onBack={() => {}} />);
  expect(texts(tree.root)).not.toContain('New thread');
  expect(texts(tree.root)).not.toContain(
    'Nothing here yet — send a message to start.',
  );
  expect(
    tree.root.findAll(n => n.props.testID === 'session-title-pill').length,
  ).toBe(0);
  expect(
    tree.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBeGreaterThan(0);
});

test('populated demo transcript does not abort into the error boundary', async () => {
  const raw = demoTranscripts(1_800_000_000_000)[CHAT_WORKING] ?? [];
  const entries = raw
    .map(entryFrom)
    .filter((e): e is NonNullable<typeof e> => e !== undefined);
  act(() => {
    workspaceStore.setState(s => ({
      ...s,
      chats: [{ ...chat, id: CHAT_WORKING, title: 'Ship demo mode' }],
    }));
    getSessionStore(CHAT_WORKING).setState({
      entries,
      commands: [],
      queue: [],
      meta: {},
      pendingSends: [],
      failedSends: [],
      unsyncedCommandIds: [],
      room: 'caughtUp',
      queueActionsPending: new Set(),
    });
    // Demo checkouts stream a draft PR. usePrBadge must not rebuild a new
    // snapshot object each render (that loops and trips the error boundary).
    setChangeRequestForChat(CHAT_WORKING, {
      checkoutId: 'demo-checkout',
      deviceId: 'h1',
      cwd: '/repo',
      branch: 'main',
      changeRequest: {
        provider: 'github',
        number: 42,
        title: 'Composer chrome overhaul',
        url: 'https://github.com/example/zremote/pull/42',
        state: 'open',
        draft: true,
        baseRef: 'main',
        headRef: 'feature/composer',
      },
      updatedAt: '2026-09-19T10:00:00Z',
    });
  });
  const tree = await render(
    <AppErrorBoundary resetKey={CHAT_WORKING}>
      <SessionScreen chatId={CHAT_WORKING} onBack={() => {}} />
    </AppErrorBoundary>,
  );
  expect(
    tree.root.findAll(n => n.props.testID === 'app-error-fallback'),
  ).toHaveLength(0);
  expect(texts(tree.root).join(' ')).toContain('demo mode');
});

test('history empty copy is short', async () => {
  const tree = await render(<HistoryScreen chatId="c1" />);
  expect(texts(tree.root)).toContain('No change requests');
});

test('session sheet insets content below the overlay grabber', async () => {
  const listed = await render(
    <SessionSheet title="History" fill onDismiss={() => {}}>
      <Text>body</Text>
    </SessionSheet>,
  );
  const sheet = byTestId(listed.root, 'session-sheet')[0];
  const style = Array.isArray(sheet.props.style)
    ? sheet.props.style.flat()
    : [sheet.props.style];
  expect(style.some(s => s && s.paddingTop === 24)).toBe(true);
});

test('session sheet fill does not collapse body content', async () => {
  const listed = await render(
    <SessionSheet title="History" fill onDismiss={() => {}}>
      <Text>body</Text>
    </SessionSheet>,
  );
  const wrap = StyleSheet.flatten(
    byTestId(listed.root, 'session-sheet')[0].props.style,
  );
  expect(wrap).toEqual(expect.objectContaining({ flex: 1, minHeight: '100%' }));
  const body = StyleSheet.flatten(
    byTestId(listed.root, 'session-sheet-body')[0].props.style,
  );
  expect(body).toEqual(expect.objectContaining({ flex: 1, minHeight: 0 }));
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
