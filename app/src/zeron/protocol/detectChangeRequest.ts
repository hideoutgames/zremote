// Catch session/thread PRs the host never resolved.
//
// `WatchCheckoutChangeRequest` asks the owning device to resolve the
// checkout's pull request through the host's `gh` CLI — GitHub only. When the
// remote is any other provider (GitLab, Bitbucket, Azure DevOps,
// Gitea/Forgejo/Codeberg, GitHub Enterprise without `gh`), or the checkout
// watch has no answer for the thread, the agent's printed PR/MR URL is the
// only signal left. Every harness reports one — it's harness-agnostic
// because the URL is the invariant output.
//
// Detected summaries are synthesized (`state: 'open'`, empty refs) — the URL
// can't tell us lifecycle state, and the checkout result always wins when
// both exist (see `collectThreadPrs` / `effectiveChangeRequest`).

import type { ChangeRequestSummary, MessageEntry, MessagePart } from './types';

/** http(s) URLs. `()`/`[]`/`<>` are excluded so markdown links and HTML end
 * cleanly; terminal punctuation is stripped after the match. */
const URL_RE = /\bhttps?:\/\/[^\s"'`<>[\]{}()*]+/gi;

const TRAILING_PUNCT = /[.,;:!?'"&~]+$|\/+$/u;

interface UrlParts {
  url: string;
  host: string;
  path: string;
  query: string;
}

const urlParts = (raw: string): UrlParts | undefined => {
  const url = raw.replace(TRAILING_PUNCT, '');
  const scheme = /^https?:\/\//i.exec(url);
  if (scheme === null) return undefined;
  const rest = url.slice(scheme[0].length);
  const hostEnd = rest.search(/[/?#]/);
  const host = (hostEnd < 0 ? rest : rest.slice(0, hostEnd)).toLowerCase();
  const tail = hostEnd < 0 ? '' : rest.slice(hostEnd);
  const qix = tail.search(/[?#]/);
  const path = qix < 0 ? tail : tail.slice(0, qix);
  const query = qix < 0 ? '' : tail.slice(qix);
  if (host === '') return undefined;
  return { url, host, path, query };
};

/** `path` segment just before the PR marker — used as a repo-ish title hint
 * when the thread offers no better label. */
const repoHint = (path: string, markerIndex: number): string => {
  const before = path.slice(0, markerIndex).replace(/\/+$/, '');
  const seg = before.split('/').pop() ?? '';
  return seg === '_git' || seg === 'repos' || seg === '-' ? '' : seg;
};

/** Ordered so the more specific shapes win over the generic `/pull/` tail. */
const PROVIDER_PATTERNS: {
  provider: string;
  re: RegExp;
  markerAt: (m: RegExpMatchArray) => number;
}[] = [
  {
    // GitLab (also nested groups): /a/b/-/merge_requests/34, legacy /a/b/merge_requests/34
    provider: 'gitlab',
    re: /\/(?:-\/)?merge_requests\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index,
  },
  {
    // Bitbucket Server/Stash: /projects/P/repos/R/pull-requests/12
    provider: 'bitbucket',
    re: /\/projects\/[^/]+\/repos\/[^/]+\/pull-requests\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index + m[0].lastIndexOf('/pull-requests'),
  },
  {
    // Bitbucket Cloud: /ws/repo/pull-requests/12
    provider: 'bitbucket',
    re: /\/pull-requests\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index,
  },
  {
    // Azure DevOps: /org/project/_git/repo/pullrequest/12 (+ visualstudio.com)
    provider: 'azure-devops',
    re: /\/pullrequest\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index,
  },
  {
    // Gitea/Forgejo/Codeberg: /owner/repo/pulls/8
    provider: 'gitea',
    re: /\/pulls\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index,
  },
  {
    // GitHub + GitHub Enterprise: /owner/repo/pull/47
    provider: 'github',
    re: /\/pull\/(\d+)(?:[/?#]|$)/i,
    markerAt: m => m.index,
  },
];

const classify = (parts: UrlParts): ChangeRequestSummary | undefined => {
  for (const { provider, re, markerAt } of PROVIDER_PATTERNS) {
    const m = parts.path.match(re);
    if (m === null) continue;
    const number = parseInt(m[1], 10);
    if (!Number.isFinite(number) || number <= 0) continue;
    return {
      provider,
      number,
      title: repoHint(parts.path, markerAt(m)),
      url: parts.url,
      state: 'open',
      baseRef: '',
      headRef: '',
    };
  }
  // Azure DevOps exposes the id as a query param on some link shapes
  // (`?pullRequestId=12`); only inside a `/_git/` repo path to stay a PR.
  const idMatch = /[?&]pullrequestid=(\d+)/i.exec(parts.query);
  if (idMatch !== null && /\/_git\//i.test(parts.path)) {
    return {
      provider: 'azure-devops',
      number: parseInt(idMatch[1], 10),
      title: repoHint(parts.path, parts.path.length),
      url: parts.url,
      state: 'open',
      baseRef: '',
      headRef: '',
    };
  }
  return undefined;
};

/** Text blobs one message part offers the scanner. */
const partTexts = (part: MessagePart): string[] => {
  switch (part.kind) {
    case 'text':
    case 'reasoning':
      return [part.text];
    case 'tool': {
      const texts: string[] = [];
      const call = part.call as Record<string, unknown>;
      if (typeof call.command === 'string') texts.push(call.command);
      if (part.output !== undefined) texts.push(part.output);
      if (part.subagentTail !== undefined) texts.push(part.subagentTail);
      return texts;
    }
    case 'error':
      return [part.message];
    default:
      return [];
  }
};

/** PRs found in one entry, in document order. */
export const detectEntryPrs = (entry: MessageEntry): ChangeRequestSummary[] => {
  const out: ChangeRequestSummary[] = [];
  for (const part of entry.parts) {
    for (const text of partTexts(part)) {
      URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = URL_RE.exec(text)) !== null) {
        const parts = urlParts(m[0]);
        if (parts === undefined) continue;
        const summary = classify(parts);
        if (summary !== undefined) out.push(summary);
      }
    }
  }
  return out;
};

/**
 * All PR/MR URLs the agent reported in this thread, newest first, deduped
 * by URL. Only assistant entries are scanned — a link the user pasted is not
 * evidence the session produced the request.
 */
export const detectThreadPrs = (
  entries: readonly MessageEntry[],
): ChangeRequestSummary[] => {
  const seen = new Set<string>();
  const out: ChangeRequestSummary[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.role !== 'assistant') continue;
    const found = detectEntryPrs(entry);
    for (let j = found.length - 1; j >= 0; j--) {
      const pr = found[j];
      if (seen.has(pr.url)) continue;
      seen.add(pr.url);
      out.push(pr);
    }
  }
  return out;
};

/** Structural equality — detected lists are re-synthesized per scan, so
 * identity alone would churn store subscribers. */
export const sameDetectedPrs = (
  a: readonly ChangeRequestSummary[] | undefined,
  b: readonly ChangeRequestSummary[] | undefined,
): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (x, i) =>
      x.url === b[i].url &&
      x.number === b[i].number &&
      x.provider === b[i].provider &&
      x.title === b[i].title &&
      x.state === b[i].state,
  );
};

/**
 * Incremental per-entry cache. Streaming re-projects `entries` constantly;
 * settled entries are immutable, so only the changed tail is re-scanned.
 * Cache eviction follows the chat's own lifetime (session close calls
 * `remove(chatId)`).
 */
export class ThreadPrScanner {
  private cache = new Map<
    string,
    { fingerprint: string; prs: ChangeRequestSummary[] }
  >();

  private fingerprint(entry: MessageEntry): string {
    let len = 0;
    for (const part of entry.parts) {
      for (const text of partTexts(part)) len += text.length;
    }
    return `${entry.id}:${entry.status ?? ''}:${entry.parts.length}:${len}`;
  }

  scan(entries: readonly MessageEntry[]): ChangeRequestSummary[] {
    const alive = new Set<string>();
    for (const entry of entries) {
      alive.add(entry.id);
      if (entry.role !== 'assistant') continue;
      const fp = this.fingerprint(entry);
      const hit = this.cache.get(entry.id);
      if (hit === undefined || hit.fingerprint !== fp) {
        this.cache.set(entry.id, {
          fingerprint: fp,
          prs: detectEntryPrs(entry),
        });
      }
    }
    for (const id of this.cache.keys()) {
      if (!alive.has(id)) this.cache.delete(id);
    }
    const seen = new Set<string>();
    const out: ChangeRequestSummary[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.role !== 'assistant') continue;
      const found = this.cache.get(entry.id)?.prs ?? [];
      for (let j = found.length - 1; j >= 0; j--) {
        const pr = found[j];
        if (seen.has(pr.url)) continue;
        seen.add(pr.url);
        out.push(pr);
      }
    }
    return out;
  }
}

const scanners = new Map<string, ThreadPrScanner>();

/** Scan one chat's transcript, reusing its incremental cache. */
export const scanThreadPrs = (
  chatId: string,
  entries: readonly MessageEntry[],
): ChangeRequestSummary[] => {
  let s = scanners.get(chatId);
  if (s === undefined) {
    s = new ThreadPrScanner();
    scanners.set(chatId, s);
  }
  return s.scan(entries);
};

/** Drop the chat's scan cache (session close / store teardown). */
export const clearThreadPrScanner = (chatId: string): void => {
  scanners.delete(chatId);
};
