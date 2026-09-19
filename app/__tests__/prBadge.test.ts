import {
  hasPrStats,
  isCheckoutPr,
  prBadgeModel,
  prStateLabelKey,
  threadPrDot,
} from '../src/components/prBadge';
import type { ChangeRequestSummary } from '../src/zeron/protocol/types';

const summary = (
  over: Partial<ChangeRequestSummary> = {},
): ChangeRequestSummary => ({
  provider: 'github',
  number: 12,
  title: 'Fix\nline',
  url: 'https://example.com/12',
  state: 'open',
  baseRef: 'main',
  headRef: 'feat',
  ...over,
});

test('closed PRs are hidden', () => {
  expect(prBadgeModel(summary({ state: 'closed' }))).toBeUndefined();
});

test('open and merged hide counts', () => {
  const open = prBadgeModel(summary(), {
    additions: 10,
    deletions: 2,
    files: [{}, {}, {}],
  });
  expect(open?.tone).toBe('open');
  expect(open?.label).toBe('viewPr');
  expect(open?.showCounts).toBe(false);
  expect(open?.title).toBe('Fix line');
  expect(open?.fileCount).toBe(3);
  expect(open?.additions).toBe(10);

  const merged = prBadgeModel(summary({ state: 'merged' }));
  expect(merged?.tone).toBe('merged');
  expect(merged?.showCounts).toBe(false);
  expect(merged?.fileCount).toBe(0);
});

test('draft shows working-tree counts', () => {
  const draft = prBadgeModel(summary({ draft: true }), {
    additions: 135,
    deletions: 56,
  });
  expect(draft?.tone).toBe('draft');
  expect(draft?.label).toBe('viewPrDraft');
  expect(draft?.showCounts).toBe(true);
  expect(draft?.additions).toBe(135);
  expect(draft?.deletions).toBe(56);
});

test('threadPrDot maps checkout CR to list dots', () => {
  expect(threadPrDot(undefined)).toBeNull();
  expect(threadPrDot(null)).toBeNull();
  expect(threadPrDot(summary({ state: 'closed' }))).toBeNull();
  expect(threadPrDot(summary({ state: 'open' }))).toBe('open');
  expect(threadPrDot(summary({ state: 'open', draft: true }))).toBe('draft');
  expect(threadPrDot(summary({ state: 'merged' }))).toBe('merged');
  expect(threadPrDot(summary({ state: 'merged', draft: true }))).toBe('merged');
});

test('hasPrStats is true when any checkout total is non-zero', () => {
  const base = prBadgeModel(summary())!;
  expect(hasPrStats(base)).toBe(false);
  expect(hasPrStats({ ...base, additions: 1 })).toBe(true);
  expect(hasPrStats({ ...base, fileCount: 2 })).toBe(true);
});

test('isCheckoutPr matches URL when both sides have one', () => {
  const badge = prBadgeModel(summary())!;
  expect(isCheckoutPr(badge, summary())).toBe(true);
  expect(
    isCheckoutPr(badge, summary({ url: 'https://example.com/99', number: 12 })),
  ).toBe(false);
  expect(isCheckoutPr(badge, undefined)).toBe(false);
});

test('prStateLabelKey prefers closed over draft/open tone', () => {
  const closed = {
    ...prBadgeModel(summary())!,
    state: 'closed' as const,
  };
  expect(prStateLabelKey(closed)).toBe('pr.closed');
  expect(prStateLabelKey(prBadgeModel(summary({ draft: true }))!)).toBe(
    'pr.draft',
  );
});
