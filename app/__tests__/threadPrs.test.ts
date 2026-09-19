import {
  collectThreadPrs,
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
