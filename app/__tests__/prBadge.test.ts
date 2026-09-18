import { prBadgeModel } from '../src/components/prBadge';
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
  const open = prBadgeModel(summary(), { additions: 10, deletions: 2 });
  expect(open?.tone).toBe('open');
  expect(open?.label).toBe('viewPr');
  expect(open?.showCounts).toBe(false);
  expect(open?.title).toBe('Fix line');

  const merged = prBadgeModel(summary({ state: 'merged' }));
  expect(merged?.tone).toBe('merged');
  expect(merged?.showCounts).toBe(false);
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
