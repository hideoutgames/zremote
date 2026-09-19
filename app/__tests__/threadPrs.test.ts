import {
  collectThreadPrs,
  composerPrBadge,
  badgeFromSummary,
} from '../src/components/threadPrs';
import type { ChangeRequestSummary } from '../src/zeron/protocol/types';

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
