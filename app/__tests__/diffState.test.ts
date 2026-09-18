import {
  diffForCheckout,
  diffPaneReducer,
  type DiffPaneState,
} from '../src/zeron/diff/diffState';
import type { CheckoutDiff } from '../src/zeron/protocol/types';

const diff = (files: CheckoutDiff['files']): CheckoutDiff => ({
  checkoutId: 'co1',
  deviceId: 'd1',
  cwd: '/repo',
  patch: '',
  files,
  additions: 1,
  deletions: 0,
  truncated: false,
  checksum: 'abc',
  updatedAt: '2025-01-01T00:00:00Z',
});

const fileRow = {
  path: 'a.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  binary: false,
};

test('preparing → rows → clean transitions', () => {
  let s: DiffPaneState = { kind: 'preparing' };
  s = diffPaneReducer(s, { type: 'diff', diff: diff([fileRow]) });
  expect(s.kind).toBe('rows');
  s = diffPaneReducer(s, { type: 'diff', diff: diff([]) });
  expect(s.kind).toBe('clean');
});

test('missing checkout keeps preparing; errors surface verbatim', () => {
  let s: DiffPaneState = { kind: 'preparing' };
  s = diffPaneReducer(s, { type: 'diff', diff: undefined });
  expect(s.kind).toBe('preparing');
  s = diffPaneReducer(s, {
    type: 'error',
    message: 'diff sync not ready',
  });
  expect(s).toEqual({ kind: 'error', message: 'diff sync not ready' });
});

test('toggle expands/collapses; a new diff resets expansion', () => {
  let s: DiffPaneState = { kind: 'preparing' };
  s = diffPaneReducer(s, { type: 'diff', diff: diff([fileRow]) });
  s = diffPaneReducer(s, { type: 'toggle', path: 'a.ts' });
  expect(s.kind === 'rows' && s.expanded.has('a.ts')).toBe(true);
  s = diffPaneReducer(s, { type: 'toggle', path: 'a.ts' });
  expect(s.kind === 'rows' && s.expanded.has('a.ts')).toBe(false);
  s = diffPaneReducer(s, { type: 'toggle', path: 'a.ts' });
  // Same checkout keeps expansion across updates; a different checkout resets.
  s = diffPaneReducer(s, {
    type: 'diff',
    diff: { ...diff([fileRow]), checksum: 'other' },
  });
  expect(s.kind === 'rows' && s.expanded.has('a.ts')).toBe(true);
  s = diffPaneReducer(s, {
    type: 'diff',
    diff: { ...diff([fileRow]), checkoutId: 'co2' },
  });
  expect(s.kind === 'rows' && s.expanded.size).toBe(0);
});

test('diffForCheckout filters the watched vec', () => {
  const diffs = [diff([fileRow]), { ...diff([]), checkoutId: 'co2' }];
  expect(diffForCheckout(diffs, 'co2')?.checkoutId).toBe('co2');
  expect(diffForCheckout(diffs, 'nope')).toBeUndefined();
});
