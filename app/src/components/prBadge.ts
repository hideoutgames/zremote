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
  title: string;
  state: ChangeRequestState;
  url: string;
  number: number;
  body?: string;
  baseRef: string;
  headRef: string;
}

export const isDraftSummary = (summary: ChangeRequestSummary): boolean =>
  summary.draft === true;

export const prBadgeModel = (
  summary: ChangeRequestSummary,
  diff?: Pick<CheckoutDiff, 'additions' | 'deletions'>,
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
    title: summary.title.replace(/[\r\n]+/g, ' '),
    state: summary.state,
    url: summary.url,
    number: summary.number,
    body: summary.body ?? summary.description,
    baseRef: summary.baseRef,
    headRef: summary.headRef,
  };
};
