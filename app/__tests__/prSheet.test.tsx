import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Share, Text } from 'react-native';
import { PrSheet } from '../src/components/PrSheet';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import {
  changeRequestStore,
  setChangeRequestForChat,
  setCheckoutDiffForChat,
} from '../src/zeron/state/changeRequestStore';
import type { PrBadgeModel } from '../src/components/prBadge';
import type { GitHistoryPage } from '../src/zeron/protocol/types';

const services = (runtime: AppServices['runtime'] = null): AppServices => ({
  auth: null as never,
  runtime,
  openSession: () => {},
  signOut: async () => {},
});

const badge = (over: Partial<PrBadgeModel> = {}): PrBadgeModel => ({
  tone: 'open',
  label: 'viewPr',
  showCounts: false,
  additions: 539,
  deletions: 214,
  fileCount: 24,
  title: 'Composer queue glass, square attachments, and chat inset',
  state: 'open',
  url: 'https://github.com/hideoutgames/zremote/pull/19',
  number: 19,
  body: 'The chat composer now treats the queue count as a real control.',
  baseRef: 'main',
  headRef: 'feat/composer',
  ...over,
});

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

const trees: TestRenderer.ReactTestRenderer[] = [];
const render = async (
  element: React.ReactElement,
  runtime: AppServices['runtime'] = null,
) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services(runtime)}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  trees.push(tree!);
  return tree!;
};

beforeEach(() => {
  act(() => {
    workspaceStore.setState({
      devices: [
        {
          id: 'h1',
          name: 'workstation',
          platform: 'macos',
          capabilities: [],
          version: '0.2.72',
        },
      ],
      spaces: [],
      chats: [
        {
          id: 'c1',
          deviceId: 'h1',
          title: 'Demo',
          archived: false,
          createdAt: 1,
          cwd: '/repo',
          branch: 'feat',
        },
      ],
      sessions: {},
      presence: {},
      connection: 'connected',
      lastSyncAt: undefined,
    });
    changeRequestStore.setState({ byChat: {}, diffByChat: {} });
  });
});

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount();
    trees.length = 0;
  });
  jest.restoreAllMocks();
});

test('overview shows Open badge, checkout stats, title, and tabs', async () => {
  const tree = await render(
    <PrSheet chatId="c1" badge={badge()} onDismiss={() => {}} />,
  );
  const labels = texts(tree.root);
  expect(labels).toContain('Open');
  expect(labels).toContain('+539');
  expect(labels).toContain('-214');
  expect(labels).toContain(
    'Composer queue glass, square attachments, and chat inset',
  );
  expect(labels).toContain('Overview');
  expect(labels).toContain('Discussion');
  expect(labels).toContain('Commits');
  expect(labels).toContain('Copy link');
  expect(labels).toContain('Open in browser');
  expect(labels).toContain('What changed');
  expect(labels).toContain('main ← feat/composer');
  expect(tree.root.findByProps({ testID: 'pr-share' })).toBeTruthy();
});

test('drafts keep Zeron chrome without GitHub merge CTAs', async () => {
  const tree = await render(
    <PrSheet
      chatId="c1"
      badge={badge({ tone: 'draft', label: 'viewPrDraft' })}
      onDismiss={() => {}}
    />,
  );
  const labels = texts(tree.root);
  expect(labels).toContain('Copy link');
  expect(labels).toContain('Open in browser');
  expect(labels).not.toContain('Open on GitHub');
  expect(labels).not.toContain('Squash & Merge');
});

test('merged PRs omit provider merge actions', async () => {
  const tree = await render(
    <PrSheet
      chatId="c1"
      badge={badge({ tone: 'merged', state: 'merged' })}
      onDismiss={() => {}}
    />,
  );
  expect(texts(tree.root)).toContain('Merged');
  expect(texts(tree.root)).not.toContain('Squash & Merge');
});

test('overview has no GitHub merge CTA', async () => {
  const tree = await render(
    <PrSheet chatId="c1" badge={badge()} onDismiss={() => {}} />,
  );
  expect(
    tree.root.findAll(n => n.props.testID === 'pr-squash-merge'),
  ).toHaveLength(0);
  expect(texts(tree.root)).not.toContain('Squash & Merge');
  expect(texts(tree.root)).not.toContain('Open on GitHub');
});

test('share uses the change-request URL', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.sharedAction } as never);
  const tree = await render(
    <PrSheet chatId="c1" badge={badge()} onDismiss={() => {}} />,
  );
  await act(async () => {
    tree.root.findByProps({ testID: 'pr-share' }).props.onPress();
  });
  expect(share).toHaveBeenCalledWith({
    url: 'https://github.com/hideoutgames/zremote/pull/19',
  });
});

test('discussion tab lists checkout git history', async () => {
  const page: GitHistoryPage = {
    commits: [
      {
        sha: 'aaa001',
        parentShas: [],
        subject: 'Make queued pill Liquid Glass',
        authorName: 'Cursor Agent',
        authorEmail: 'agent@example.test',
        authoredAt: new Date().toISOString(),
        refs: [],
      },
    ],
    branchTips: [],
  };
  const runtime = {
    relayFor: () => ({
      call: async () => page,
    }),
  } as never;
  const tree = await render(
    <PrSheet chatId="c1" badge={badge()} onDismiss={() => {}} />,
    runtime,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    tree.root.findByProps({ testID: 'pr-tab-discussion' }).props.onPress();
  });
  const labels = texts(tree.root);
  expect(labels).toContain('Cursor Agent committed');
  expect(labels).toContain('Make queued pill Liquid Glass');
  expect(labels).toContain('Today');
});

test('live checkout diff updates header stats', async () => {
  act(() => {
    setChangeRequestForChat('c1', {
      checkoutId: 'ck',
      deviceId: 'h1',
      cwd: '/repo',
      branch: 'feat',
      changeRequest: {
        provider: 'github',
        number: 19,
        title: 'Composer queue glass, square attachments, and chat inset',
        url: 'https://github.com/hideoutgames/zremote/pull/19',
        state: 'open',
        baseRef: 'main',
        headRef: 'feat/composer',
      },
      updatedAt: '2026-09-19T00:00:00Z',
    });
  });
  const tree = await render(
    <PrSheet
      chatId="c1"
      badge={badge({ additions: 1, deletions: 0, fileCount: 1 })}
      onDismiss={() => {}}
    />,
  );
  act(() => {
    setCheckoutDiffForChat('c1', {
      checkoutId: 'ck',
      deviceId: 'h1',
      cwd: '/repo',
      patch: '',
      files: [
        {
          path: 'a.ts',
          status: 'modified',
          additions: 4,
          deletions: 1,
          binary: false,
        },
      ],
      additions: 4,
      deletions: 1,
      truncated: false,
      checksum: 'x',
      updatedAt: '2026-09-19T00:00:00Z',
    });
  });
  expect(texts(tree.root)).toContain('+4');
  expect(texts(tree.root)).toContain('-1');
});
