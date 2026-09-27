import {
  collectThreadPrs,
  composerPrBadge,
  badgeFromSummary,
  threadPrMentions,
} from '../src/components/threadPrs';
import type {
  ChangeRequestSummary,
  MessageEntry,
} from '../src/zeron/protocol/types';

const summary = (
  over: Partial<ChangeRequestSummary> = {},
): ChangeRequestSummary => ({
  provider: 'github',
  number: 7,
  title: 'Composer chrome',
  url: 'https://example.test/change/7',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  ...over,
});

test('collectThreadPrs is the checkout change request only', () => {
  const prs = collectThreadPrs(summary(), { additions: 4, deletions: 1 });
  expect(prs).toHaveLength(1);
  expect(prs[0].number).toBe(7);
  expect(prs[0].title).toBe('Composer chrome');
  expect(prs[0].fileCount).toBe(0);
});

test('closed checkout change requests still appear in history', () => {
  const badge = badgeFromSummary(summary({ state: 'closed' }));
  expect(badge.state).toBe('closed');
  expect(collectThreadPrs(summary({ state: 'closed' }))).toHaveLength(1);
});

test('empty thread has no change requests', () => {
  expect(collectThreadPrs()).toEqual([]);
  expect(collectThreadPrs(null)).toEqual([]);
});

test('composerPrBadge hides closed-only and placeholder CRs', () => {
  expect(composerPrBadge()).toBeUndefined();
  expect(composerPrBadge(summary({ state: 'closed' }))).toBeUndefined();
  expect(
    composerPrBadge(summary({ number: 0, url: '', state: 'open' })),
  ).toBeUndefined();
});

test('composerPrBadge shows draft, open, and merged checkout CRs', () => {
  expect(composerPrBadge(summary({ draft: true }))?.tone).toBe('draft');
  expect(composerPrBadge(summary({ state: 'open' }))?.number).toBe(7);
  expect(composerPrBadge(summary({ state: 'merged' }))?.tone).toBe('merged');
});

test('placeholder checkout does not hide a linked pull request', () => {
  const linked = summary({
    number: 4,
    title: 'app',
    url: 'https://github.com/acme/app/pull/4',
    baseRef: '',
    headRef: '',
  });
  const prs = collectThreadPrs(
    summary({ number: 0, url: '', title: '', state: 'open' }),
    { additions: 9, deletions: 1, files: [{}, {}] },
    [linked],
  );
  expect(prs.map(p => p.number)).toEqual([4]);
  expect(prs[0].fileCount).toBe(0);
  expect(prs[0].weakTitle).toBe(true);
  expect(prs[0].resolved).toBe(false);
  expect(
    composerPrBadge(summary({ number: 0, url: '', title: '' }), undefined, [
      linked,
    ])?.number,
  ).toBe(4);
});

test('files url and checkout url are one row, and a second request stays', () => {
  const prs = collectThreadPrs(
    summary({
      number: 7,
      title: 'Real title',
      url: 'https://github.com/acme/app/pull/7',
    }),
    { additions: 3, deletions: 1, files: [{}] },
    [
      summary({
        number: 7,
        title: 'app',
        url: 'https://github.com/acme/app/pull/7/files',
        baseRef: '',
        headRef: '',
      }),
      summary({
        number: 2,
        title: 'r',
        url: 'https://gitlab.com/g/r/-/merge_requests/2',
        baseRef: '',
        headRef: '',
      }),
    ],
  );
  expect(prs.map(p => p.number)).toEqual([7, 2]);
  expect(prs[0].title).toBe('Real title');
  expect(prs[0].fileCount).toBe(1);
  expect(prs[0].url).toBe('https://github.com/acme/app/pull/7');
  expect(prs[1].fileCount).toBe(0);
  expect(prs[1].resolved).toBe(false);
  expect(prs[1].repoLabel).toBe('g/r');
});

test('a closed checkout does not hide a newer open link', () => {
  const badge = composerPrBadge(summary({ state: 'closed' }), undefined, [
    summary({
      number: 8,
      title: 'Follow-up',
      url: 'https://github.com/acme/app/pull/8',
      baseRef: '',
      headRef: '',
    }),
  ]);
  expect(badge?.number).toBe(8);
  expect(
    collectThreadPrs(summary({ state: 'closed' }), undefined, [
      summary({
        number: 8,
        title: 'Follow-up',
        url: 'https://github.com/acme/app/pull/8',
        baseRef: '',
        headRef: '',
      }),
    ]).map(p => p.number),
  ).toEqual([7, 8]);
});

test('threadPrMentions lists user and assistant lines for that request only', () => {
  const entries: MessageEntry[] = [
    {
      id: 'u1',
      role: 'user',
      createdAt: 10,
      deviceId: 'h',
      parts: [
        {
          kind: 'text',
          id: 't1',
          text: 'Look at [Fix login flake](https://github.com/acme/app/pull/7/files)',
        },
      ],
    },
    {
      id: 'a1',
      role: 'assistant',
      createdAt: 20,
      deviceId: 'h',
      parts: [
        {
          kind: 'text',
          id: 't2',
          text: 'Also opened https://github.com/acme/app/pull/9',
        },
      ],
    },
  ];
  const mentions = threadPrMentions(entries, {
    url: 'https://github.com/acme/app/pull/7',
    number: 7,
  });
  expect(mentions).toHaveLength(1);
  expect(mentions[0].role).toBe('user');
  expect(mentions[0].excerpt).toBe('Fix login flake');
});
