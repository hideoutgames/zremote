// Changes-pane state reducer — pure. Mirrors the desktop diff pane states
// (crates/ui/src/diff*.rs): preparing while no diff has landed, clean when
// the latest diff is empty, error on RPC failure, rows otherwise.

import type { CheckoutDiff, DiffFileSummary } from '../protocol/types';

export type DiffPaneState =
  | { kind: 'preparing' }
  | { kind: 'clean'; updatedAt: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'rows';
      diff: CheckoutDiff;
      /** per-file expansion keys (paths). */
      expanded: ReadonlySet<string>;
    };

/** Reduce a `WatchCheckoutDiffs` item (the whole Vec<CheckoutDiff>) to the
 * row for `checkoutId`. */
export const diffForCheckout = (
  diffs: readonly CheckoutDiff[],
  checkoutId: string,
): CheckoutDiff | undefined => diffs.find(d => d.checkoutId === checkoutId);

export const diffPaneReducer = (
  prev: DiffPaneState,
  event:
    | { type: 'diff'; diff: CheckoutDiff | undefined }
    | { type: 'error'; message: string }
    | { type: 'toggle'; path: string },
): DiffPaneState => {
  switch (event.type) {
    case 'error':
      return { kind: 'error', message: event.message };
    case 'diff': {
      if (event.diff === undefined) {
        return prev.kind === 'preparing' ? prev : { kind: 'preparing' };
      }
      if (event.diff.files.length === 0) {
        return { kind: 'clean', updatedAt: event.diff.updatedAt };
      }
      const expanded =
        prev.kind === 'rows' && prev.diff.checkoutId === event.diff.checkoutId
          ? prev.expanded
          : new Set<string>();
      return { kind: 'rows', diff: event.diff, expanded };
    }
    case 'toggle': {
      if (prev.kind !== 'rows') return prev;
      const expanded = new Set(prev.expanded);
      if (expanded.has(event.path)) expanded.delete(event.path);
      else expanded.add(event.path);
      return { ...prev, expanded };
    }
  }
};

export const statusGlyph = (f: DiffFileSummary): string =>
  f.status === 'added'
    ? 'A'
    : f.status === 'deleted'
    ? 'D'
    : f.status === 'renamed'
    ? 'R'
    : 'M';
