// Collect pull requests visible in a thread: the checkout's current change
// request (WatchCheckoutChangeRequest) plus github.com/.../pull/N URLs in
// transcript text. Host has no "list PRs for chat" RPC.

import type {
  ChangeRequestSummary,
  CheckoutDiff,
  MessageEntry,
} from '../zeron/protocol/types';
import { prBadgeModel, type PrBadgeModel } from './prBadge';

const PR_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;

export const badgeFromSummary = (
  summary: ChangeRequestSummary,
  diff?: Pick<CheckoutDiff, 'additions' | 'deletions'>,
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
    title: summary.title.replace(/[\r\n]+/g, ' '),
    state: summary.state,
    url: summary.url,
    number: summary.number,
    body: summary.body ?? summary.description,
    baseRef: summary.baseRef,
    headRef: summary.headRef,
  };
};

export const extractPrsFromText = (text: string): PrBadgeModel[] => {
  const out: PrBadgeModel[] = [];
  const re = new RegExp(PR_URL.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const owner = m[1];
    const repo = m[2];
    const number = Number(m[3]);
    const url = `https://github.com/${owner}/${repo}/pull/${number}`;
    out.push({
      tone: 'open',
      label: 'viewPr',
      showCounts: false,
      additions: 0,
      deletions: 0,
      title: `${owner}/${repo}#${number}`,
      state: 'open',
      url,
      number,
      baseRef: '',
      headRef: '',
    });
  }
  return out;
};

const textOf = (entry: MessageEntry): string =>
  entry.parts
    .filter(
      (p): p is { kind: 'text'; id: string; text: string } => p.kind === 'text',
    )
    .map(p => p.text)
    .join('\n');

export const collectThreadPrs = (
  entries: MessageEntry[],
  checkout?: ChangeRequestSummary | null,
  diff?: Pick<CheckoutDiff, 'additions' | 'deletions'>,
): PrBadgeModel[] => {
  const out: PrBadgeModel[] = [];
  const seen = new Set<string>();
  const push = (badge: PrBadgeModel) => {
    const key = badge.url !== '' ? badge.url : String(badge.number);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(badge);
  };
  if (checkout != null) push(badgeFromSummary(checkout, diff));
  for (const entry of entries) {
    for (const badge of extractPrsFromText(textOf(entry))) push(badge);
  }
  return out;
};
