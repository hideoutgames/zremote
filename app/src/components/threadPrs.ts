// Collect change requests visible in a thread from the checkout stream
// (WatchCheckoutChangeRequest). Host has no "list PRs for chat" RPC and we
// do not scrape provider URLs out of transcript text.

import type { ChangeRequestSummary } from '../zeron/protocol/types';
import {
  fileCountOf,
  prBadgeModel,
  type PrBadgeModel,
  type PrDiffCounts,
} from './prBadge';

export const badgeFromSummary = (
  summary: ChangeRequestSummary,
  diff?: PrDiffCounts,
): PrBadgeModel => {
  const fromPill = prBadgeModel(summary, diff);
  if (fromPill !== undefined) return fromPill;
  const draft = summary.draft === true;
  return {
    tone: summary.state === 'merged' ? 'merged' : draft ? 'draft' : 'open',
    label: draft ? 'viewPrDraft' : 'viewPr',
    showCounts: false,
    additions: diff?.additions ?? 0,
    deletions: diff?.deletions ?? 0,
    fileCount: fileCountOf(diff),
    title: summary.title.replace(/[\r\n]+/g, ' '),
    state: summary.state,
    url: summary.url,
    number: summary.number,
    body: summary.body ?? summary.description,
    baseRef: summary.baseRef,
    headRef: summary.headRef,
  };
};

export const collectThreadPrs = (
  checkout?: ChangeRequestSummary | null,
  diff?: PrDiffCounts,
): PrBadgeModel[] => {
  if (checkout == null) return [];
  return [badgeFromSummary(checkout, diff)];
};

const hasPrIdentity = (badge: PrBadgeModel): boolean =>
  badge.url !== '' || badge.number > 0;

/** Composer chrome pill: a real, non-closed checkout CR (draft, open, or
 * merged). Closed-only and placeholder summaries stay hidden. History still
 * lists closed checkout CRs via `collectThreadPrs`. */
export const composerPrBadge = (
  checkout?: ChangeRequestSummary | null,
  diff?: PrDiffCounts,
): PrBadgeModel | undefined =>
  collectThreadPrs(checkout, diff).find(
    p => p.state !== 'closed' && hasPrIdentity(p),
  );
