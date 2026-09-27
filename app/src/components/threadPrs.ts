// Collect change requests visible in a thread: the checkout stream
// (WatchCheckoutChangeRequest) first, then PR/MR URLs scanned out of the
// transcript (detectChangeRequest.ts). Same host + repo + number is one row.
// Placeholder checkout summaries (no URL, number 0) are dropped. Diff totals
// attach only to the checkout's own request.

import type {
  ChangeRequestSummary,
  MessageEntry,
} from '../zeron/protocol/types';
import {
  detectEntryPrs,
  isListableChangeRequest,
  isWeakPrTitle,
  mentionExcerpt,
  preferPrUrl,
  prIdentityFromUrl,
  prIdentityKey,
} from '../zeron/protocol/detectChangeRequest';
import {
  fileCountOf,
  presentPrBadge,
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
  return presentPrBadge(summary, {
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
  });
};

const preferTitle = (
  current: string,
  next: string,
  repo: string,
  number: number,
): string => {
  const currentWeak = isWeakPrTitle(current, repo, number);
  const nextWeak = isWeakPrTitle(next, repo, number);
  if (currentWeak && !nextWeak) return next;
  if (!currentWeak) return current;
  return current.length >= next.length ? current : next;
};

/** Host-resolved fields win. A detected link can still supply a real title
 * or a cleaner URL when the other side only has a repo slug or a /files link. */
const mergeChangeRequests = (
  current: ChangeRequestSummary,
  next: ChangeRequestSummary,
): ChangeRequestSummary => {
  const id = prIdentityFromUrl(current.url) ?? prIdentityFromUrl(next.url);
  const repo = id?.repo ?? '';
  const number = current.number > 0 ? current.number : next.number;
  const currentResolved =
    current.baseRef.trim() !== '' && current.headRef.trim() !== '';
  const nextResolved = next.baseRef.trim() !== '' && next.headRef.trim() !== '';
  const host = currentResolved ? current : nextResolved ? next : undefined;
  const other = host === current ? next : host === next ? current : undefined;
  if (host !== undefined && other !== undefined) {
    return {
      ...host,
      number: host.number > 0 ? host.number : other.number,
      title: preferTitle(host.title, other.title, repo, number),
      url: preferPrUrl(host.url, other.url),
      body: host.body ?? other.body,
      description: host.description ?? other.description,
    };
  }
  return {
    ...current,
    number,
    title: preferTitle(current.title, next.title, repo, number),
    url: preferPrUrl(current.url, next.url),
    body: current.body ?? next.body,
    description: current.description ?? next.description,
  };
};

export const collectThreadPrs = (
  checkout?: ChangeRequestSummary | null,
  diff?: PrDiffCounts,
  detected?: readonly ChangeRequestSummary[],
): PrBadgeModel[] => {
  const rows: ChangeRequestSummary[] = [];
  const index = new Map<string, number>();
  const put = (summary: ChangeRequestSummary): void => {
    if (!isListableChangeRequest(summary)) return;
    const key = prIdentityKey(summary);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, rows.length);
      rows.push(summary);
      return;
    }
    rows[at] = mergeChangeRequests(rows[at], summary);
  };
  if (checkout != null) put(checkout);
  for (const pr of detected ?? []) put(pr);
  const checkoutKey =
    checkout != null && isListableChangeRequest(checkout)
      ? prIdentityKey(checkout)
      : undefined;
  return rows.map(summary =>
    badgeFromSummary(
      summary,
      checkoutKey !== undefined && prIdentityKey(summary) === checkoutKey
        ? diff
        : undefined,
    ),
  );
};

const hasPrIdentity = (badge: PrBadgeModel): boolean =>
  badge.url !== '' || badge.number > 0;

/** Composer chrome pill: a real, non-closed checkout CR (draft, open, or
 * merged) or the newest detected thread PR when the host resolved none.
 * Closed-only and placeholder summaries stay hidden. History still lists
 * closed checkout CRs via `collectThreadPrs`. */
export const composerPrBadge = (
  checkout?: ChangeRequestSummary | null,
  diff?: PrDiffCounts,
  detected?: readonly ChangeRequestSummary[],
): PrBadgeModel | undefined =>
  collectThreadPrs(checkout, diff, detected).find(
    p => p.state !== 'closed' && hasPrIdentity(p),
  );

export const prHeadlineIsFallback = (
  badge: Pick<PrBadgeModel, 'title' | 'weakTitle'>,
): boolean => badge.weakTitle === true || badge.title.trim() === '';

export const threadPrMeta = (
  badge: Pick<PrBadgeModel, 'baseRef' | 'headRef' | 'repoLabel'>,
): string => {
  if (badge.baseRef !== '' && badge.headRef !== '')
    return `${badge.baseRef} ← ${badge.headRef}`;
  return badge.repoLabel ?? '';
};

export interface PrMention {
  id: string;
  role: 'user' | 'assistant';
  excerpt: string;
  createdAt: number;
}

/** Messages in this thread that link the same pull request, oldest first. */
export const threadPrMentions = (
  entries: readonly MessageEntry[],
  pr: Pick<PrBadgeModel, 'url' | 'number'>,
): PrMention[] => {
  const want = prIdentityFromUrl(pr.url)?.key;
  if (want === undefined && pr.url === '') return [];
  const out: PrMention[] = [];
  for (const entry of entries) {
    if (entry.role !== 'user' && entry.role !== 'assistant') continue;
    const hit = detectEntryPrs(entry).find(item => {
      const key = prIdentityFromUrl(item.url)?.key;
      if (want !== undefined && key === want) return true;
      return want === undefined && item.url === pr.url;
    });
    if (hit === undefined) continue;
    out.push({
      id: entry.id,
      role: entry.role,
      excerpt: mentionExcerpt(entry, hit.url),
      createdAt: entry.createdAt,
    });
  }
  return out;
};
