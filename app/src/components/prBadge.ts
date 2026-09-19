// PR pill presentation — maps a change-request snapshot (+ optional working
// tree diff totals) to the composer chrome. Closed PRs are hidden.

import type {
  ChangeRequestState,
  ChangeRequestSummary,
  CheckoutDiff,
} from '../zeron/protocol/types';

export type PrBadgeTone = 'open' | 'merged' | 'draft';

/** Thread-list PR dot. Closed and missing CRs have no dot. */
export type ThreadPrDot = 'draft' | 'open' | 'merged';

export const threadPrDot = (
  summary: ChangeRequestSummary | null | undefined,
): ThreadPrDot | null => {
  if (summary == null || summary.state === 'closed') return null;
  if (summary.state === 'merged') return 'merged';
  return summary.draft === true ? 'draft' : 'open';
};

export interface PrBadgeModel {
  tone: PrBadgeTone;
  label: 'viewPr' | 'viewPrDraft';
  showCounts: boolean;
  additions: number;
  deletions: number;
  fileCount: number;
  title: string;
  state: ChangeRequestState;
  url: string;
  number: number;
  body?: string;
  baseRef: string;
  headRef: string;
}

/** Checkout working-tree totals used on the PR header (not GitHub PR stats). */
export type PrDiffCounts = Pick<CheckoutDiff, 'additions' | 'deletions'> & {
  files?: readonly unknown[];
};

export const isDraftSummary = (summary: ChangeRequestSummary): boolean =>
  summary.draft === true;

export const fileCountOf = (diff?: PrDiffCounts): number =>
  diff?.files?.length ?? 0;

export const hasPrStats = (
  badge: Pick<PrBadgeModel, 'additions' | 'deletions' | 'fileCount'>,
): boolean => badge.additions > 0 || badge.deletions > 0 || badge.fileCount > 0;

export const prStateLabelKey = (
  badge: Pick<PrBadgeModel, 'state' | 'tone'>,
): 'pr.open' | 'pr.merged' | 'pr.draft' | 'pr.closed' => {
  if (badge.state === 'closed') return 'pr.closed';
  if (badge.tone === 'merged') return 'pr.merged';
  if (badge.tone === 'draft') return 'pr.draft';
  return 'pr.open';
};

export const isCheckoutPr = (
  badge: Pick<PrBadgeModel, 'url' | 'number'>,
  summary?: ChangeRequestSummary | null,
): boolean => {
  if (summary == null) return false;
  if (badge.url !== '' && summary.url !== '') return badge.url === summary.url;
  return badge.number === summary.number;
};

export const prBadgeModel = (
  summary: ChangeRequestSummary,
  diff?: PrDiffCounts,
): PrBadgeModel | undefined => {
  if (summary.state === 'closed') return undefined;
  const draft = isDraftSummary(summary);
  const tone: PrBadgeTone =
    summary.state === 'merged' ? 'merged' : draft ? 'draft' : 'open';
  const additions = diff?.additions ?? 0;
  const deletions = diff?.deletions ?? 0;
  return {
    tone,
    label: draft ? 'viewPrDraft' : 'viewPr',
    showCounts: draft,
    additions,
    deletions,
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
