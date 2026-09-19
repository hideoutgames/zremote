import {
  collectThreadPrs,
  composerPrBadge,
  extractPrsFromText,
  badgeFromSummary,
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
  url: 'https://github.com/hideoutgames/zremote/pull/7',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  ...over,
});

const entry = (text: string, id = 'e1'): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', id: `${id}-t`, text }],
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
});

test('extracts github pull URLs from text', () => {
  const prs = extractPrsFromText(
    'Opened https://github.com/acme/app/pull/12 and https://github.com/acme/app/pull/12 again',
  );
  expect(prs).toHaveLength(2);
  expect(prs[0].number).toBe(12);
  expect(prs[0].url).toBe('https://github.com/acme/app/pull/12');
  expect(prs[0].title).toBe('acme/app#12');
});

test('collectThreadPrs prefers the checkout CR then unique transcript URLs', () => {
  const prs = collectThreadPrs(
    [
      entry(
        'See https://github.com/hideoutgames/zremote/pull/7 and https://github.com/acme/app/pull/3',
      ),
    ],
    summary(),
    { additions: 4, deletions: 1 },
  );
  expect(prs.map(p => p.number)).toEqual([7, 3]);
  expect(prs[0].title).toBe('Composer chrome');
  expect(prs[0].fileCount).toBe(0);
  expect(prs[1].title).toBe('acme/app#3');
  expect(prs[1].fileCount).toBe(0);
});

test('closed checkout PRs still appear in history', () => {
  const badge = badgeFromSummary(summary({ state: 'closed' }));
  expect(badge.state).toBe('closed');
  expect(collectThreadPrs([], summary({ state: 'closed' }))).toHaveLength(1);
});

test('empty thread has no PRs', () => {
  expect(collectThreadPrs([entry('no links here')])).toEqual([]);
});

test('composerPrBadge hides closed-only and placeholder CRs', () => {
  expect(composerPrBadge([entry('no links here')])).toBeUndefined();
  expect(composerPrBadge([], summary({ state: 'closed' }))).toBeUndefined();
  expect(
    composerPrBadge([], summary({ number: 0, url: '', state: 'open' })),
  ).toBeUndefined();
});

test('composerPrBadge shows draft, open, merged, and transcript PRs', () => {
  expect(composerPrBadge([], summary({ draft: true }))?.tone).toBe('draft');
  expect(composerPrBadge([], summary({ state: 'open' }))?.number).toBe(7);
  expect(composerPrBadge([], summary({ state: 'merged' }))?.tone).toBe(
    'merged',
  );
  const fromText = composerPrBadge([
    entry('Opened https://github.com/acme/app/pull/9'),
  ]);
  expect(fromText?.number).toBe(9);
  expect(fromText?.url).toBe('https://github.com/acme/app/pull/9');
});

test('composerPrBadge prefers a live checkout PR over transcript URLs', () => {
  const badge = composerPrBadge(
    [entry('Also https://github.com/acme/app/pull/3')],
    summary({ state: 'merged' }),
  );
  expect(badge?.number).toBe(7);
  expect(badge?.tone).toBe('merged');
});
