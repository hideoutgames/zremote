// Catch session/thread PRs the host never resolved.
//
// `WatchCheckoutChangeRequest` asks the owning device to resolve the
// checkout's pull request through the host's `gh` CLI — GitHub only. When the
// remote is any other provider (GitLab, Bitbucket, Azure DevOps,
// Gitea/Forgejo/Codeberg, GitHub Enterprise without `gh`), or the checkout
// watch has no answer for the thread, the printed PR/MR URL is the signal
// left. User and assistant messages both count — a link either of them put
// in the thread is part of that thread. System text and model reasoning do
// not: reasoning is full of example URLs that were never opened.
//
// Detected summaries are synthesized (`state: 'open'`, empty refs). The URL
// cannot tell us lifecycle, so the viewer must not present that as a
// confirmed Open pull request. Identity is host + repo + number, so
// `pull/19`, `pull/19/files`, and `api.github.com/.../pulls/19` are one row.
// The checkout result wins when both describe that same request
// (`collectThreadPrs` / `effectiveChangeRequest`).

import type { ChangeRequestSummary, MessageEntry, MessagePart } from './types';

/** http(s) URLs. `()`/`[]`/`<>` are excluded so markdown links and HTML end
 * cleanly; terminal punctuation is stripped after the match. */
const URL_RE = /\bhttps?:\/\/[^\s"'`<>[\]{}()*]+/gi;

const TRAILING_PUNCT = /[.,;:!?'"&~]+$|\/+$/u;

/** Characters that may follow a PR number without starting a different id
 * (files tab, .diff/.patch, a query, or a fragment). */
const PR_END = String.raw`(?:[/?#.]|$)`;

const NOISE_SEGMENTS = new Set(['-', '_git', 'repos', 'projects']);

const WEAK_TITLES =
  /^(pull request|merge request|pr|mr|untitled|draft|link|here)$/i;

interface UrlParts {
  url: string;
  host: string;
  path: string;
  query: string;
}

export interface PrIdentity {
  key: string;
  host: string;
  repo: string;
  number: number;
  provider: string;
  /** Path ending at the PR number, when the number is in the path. */
  path: string;
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

const normalizeHost = (host: string): string => {
  const bare = host.toLowerCase().replace(/^www\./, '');
  if (bare === 'api.github.com') return 'github.com';
  return bare;
};

/** GitHub's REST links use `/repos/{owner}/{repo}/pulls/{n}` on api.github.com.
 * Rewrite that onto the web path so it matches `github.com/.../pull/{n}`. */
const matchPath = (host: string, path: string): string => {
  if (host.toLowerCase().replace(/^www\./, '') === 'api.github.com')
    return path.replace(/^\/repos\//, '/');
  return path;
};

const repoFromPath = (path: string, markerIndex: number): string => {
  let before = path.slice(0, markerIndex).replace(/^\/+|\/+$/g, '');
  if (before.startsWith('repos/')) before = before.slice('repos/'.length);
  return before
    .split('/')
    .filter(seg => seg !== '' && !NOISE_SEGMENTS.has(seg))
    .join('/');
};

const providerName = (host: string, patternProvider: string): string => {
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return 'gitlab';
  return patternProvider;
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
    re: new RegExp(String.raw`\/(?:-\/)?merge_requests\/(\d+)${PR_END}`, 'i'),
    markerAt: m => m.index ?? 0,
  },
  {
    // Bitbucket Server/Stash: /projects/P/repos/R/pull-requests/12
    provider: 'bitbucket',
    re: new RegExp(
      String.raw`\/projects\/[^/]+\/repos\/[^/]+\/pull-requests\/(\d+)${PR_END}`,
      'i',
    ),
    markerAt: m => (m.index ?? 0) + m[0].lastIndexOf('/pull-requests'),
  },
  {
    // Bitbucket Cloud: /ws/repo/pull-requests/12
    provider: 'bitbucket',
    re: new RegExp(String.raw`\/pull-requests\/(\d+)${PR_END}`, 'i'),
    markerAt: m => m.index ?? 0,
  },
  {
    // Azure DevOps: /org/project/_git/repo/pullrequest/12 (+ visualstudio.com)
    provider: 'azure-devops',
    re: new RegExp(String.raw`\/pullrequest\/(\d+)${PR_END}`, 'i'),
    markerAt: m => m.index ?? 0,
  },
  {
    // Gitea/Forgejo/Codeberg, and GitHub's API `/pulls/{n}` shape
    provider: 'gitea',
    re: new RegExp(String.raw`\/pulls\/(\d+)${PR_END}`, 'i'),
    markerAt: m => m.index ?? 0,
  },
  {
    // GitHub + GitHub Enterprise: /owner/repo/pull/47
    provider: 'github',
    re: new RegExp(String.raw`\/pull\/(\d+)${PR_END}`, 'i'),
    markerAt: m => m.index ?? 0,
  },
];

/** Stable identity for one pull request, independent of /files, .diff, or www. */
export const prIdentityFromUrl = (raw: string): PrIdentity | undefined => {
  const parts = urlParts(raw);
  if (parts === undefined) return undefined;
  const host = normalizeHost(parts.host);
  const path = matchPath(parts.host, parts.path);
  for (const pattern of PROVIDER_PATTERNS) {
    const m = path.match(pattern.re);
    if (m === null || m[1] === undefined) continue;
    const number = parseInt(m[1], 10);
    if (!Number.isFinite(number) || number <= 0) continue;
    const marker = pattern.markerAt(m);
    const repo = repoFromPath(path, marker);
    const numAt = path.indexOf(m[1], m.index ?? 0);
    const idPath = numAt >= 0 ? path.slice(0, numAt + m[1].length) : path;
    return {
      key: `${host}/${repo}#${number}`,
      host,
      repo,
      number,
      provider: providerName(host, pattern.provider),
      path: idPath,
    };
  }
  // Azure DevOps exposes the id as a query param on some link shapes
  // (`?pullRequestId=12`); only inside a `/_git/` repo path to stay a PR.
  const idMatch = /[?&]pullrequestid=(\d+)/i.exec(parts.query);
  if (idMatch?.[1] !== undefined && /\/_git\//i.test(path)) {
    const number = parseInt(idMatch[1], 10);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    const repo = repoFromPath(path, path.length);
    return {
      key: `${host}/${repo}#${number}`,
      host,
      repo,
      number,
      provider: 'azure-devops',
      path,
    };
  }
  return undefined;
};

export const prIdentityKey = (summary: {
  url: string;
  number: number;
  provider?: string;
}): string => {
  const id = prIdentityFromUrl(summary.url);
  if (id !== undefined) return id.key;
  if (summary.number > 0 && summary.url !== '')
    return `${summary.url}#${summary.number}`;
  if (summary.number > 0)
    return `${summary.provider ?? 'pr'}#${summary.number}`;
  return summary.url;
};

/** A real request: a recognized PR/MR URL, or a numbered link with a URL.
 * Empty checkout placeholders (number 0, blank URL) are not. */
export const isListableChangeRequest = (
  summary: ChangeRequestSummary | null | undefined,
): summary is ChangeRequestSummary => {
  if (summary == null) return false;
  if (prIdentityFromUrl(summary.url) !== undefined) return true;
  return summary.number > 0 && summary.url.trim() !== '';
};

/** Repo slug, "PR", or "Pull request" — not something to print as the title. */
export const isWeakPrTitle = (
  title: string,
  repo: string,
  number: number,
): boolean => {
  const value = title.replace(/\s+/g, ' ').trim();
  if (value === '') return true;
  if (WEAK_TITLES.test(value)) return true;
  if (
    number > 0 &&
    (value === `#${number}` ||
      value === `!${number}` ||
      value === `PR #${number}` ||
      value === `PR ${number}`)
  )
    return true;
  if (repo !== '') {
    const last = repo.split('/').pop() ?? '';
    if (value === repo || value === last) return true;
  }
  return false;
};

const prUrlRank = (raw: string): number => {
  const parts = urlParts(raw);
  const id = prIdentityFromUrl(raw);
  if (parts === undefined || id === undefined) return raw.trim() === '' ? 0 : 1;
  let rank = 2;
  const suffix = parts.path.startsWith(id.path)
    ? parts.path.slice(id.path.length)
    : 'x';
  if (suffix === '' || suffix === '/') rank += 4;
  if (parts.query === '') rank += 2;
  if (!parts.host.startsWith('api.')) rank += 1;
  if (id.path.includes(String(id.number))) rank += 1;
  return rank;
};

/** Prefer the bare PR URL over /files, .diff, or an API link. */
export const preferPrUrl = (current: string, next: string): string =>
  prUrlRank(next) > prUrlRank(current) ? next : current;

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

const markdownLabel = (text: string, urlStart: number): string | undefined => {
  const slice = text.slice(Math.max(0, urlStart - 3), urlStart);
  let close = -1;
  if (slice.endsWith('](')) close = urlStart - 2;
  else if (slice.endsWith('] (')) close = urlStart - 3;
  else return undefined;
  const open = text.lastIndexOf('[', close - 1);
  if (open < 0 || close - open > 180) return undefined;
  const label = text
    .slice(open + 1, close)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (label === '' || label.includes('[') || /^https?:/i.test(label))
    return undefined;
  return label;
};

const chooseTitle = (
  label: string | undefined,
  repo: string,
  number: number,
): string => {
  const cleaned = label?.replace(/[\r\n]+/g, ' ').trim() ?? '';
  if (
    cleaned !== '' &&
    !/^https?:/i.test(cleaned) &&
    !isWeakPrTitle(cleaned, repo, number)
  )
    return cleaned.slice(0, 160);
  return repo.split('/').filter(Boolean).pop() ?? '';
};

const classify = (
  raw: string,
  label?: string,
): ChangeRequestSummary | undefined => {
  const parts = urlParts(raw);
  const id = prIdentityFromUrl(raw);
  if (parts === undefined || id === undefined) return undefined;
  return {
    provider: id.provider,
    number: id.number,
    title: chooseTitle(label, id.repo, id.number),
    url: parts.url,
    state: 'open',
    baseRef: '',
    headRef: '',
  };
};

const collectHttpStrings = (value: unknown, out: string[], depth = 0): void => {
  if (depth > 6 || out.length > 32) return;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower.includes('https://') || lower.includes('http://'))
      out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpStrings(item, out, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>))
      collectHttpStrings(item, out, depth + 1);
  }
};

/** Text blobs one message part offers the scanner. Reasoning is skipped so
 * example links the model only thought about never become thread PRs. */
const partTexts = (part: MessagePart): string[] => {
  switch (part.kind) {
    case 'text':
      return [part.text];
    case 'reasoning':
      return [];
    case 'tool': {
      const texts: string[] = [];
      collectHttpStrings(part.call, texts);
      if (part.output !== undefined) collectHttpStrings(part.output, texts);
      if (part.subagentTail !== undefined)
        collectHttpStrings(part.subagentTail, texts);
      return texts;
    }
    case 'input': {
      const texts: string[] = [];
      for (const question of part.questions) {
        collectHttpStrings(question.header, texts);
        collectHttpStrings(question.question, texts);
        collectHttpStrings(question.options, texts);
      }
      return texts;
    }
    case 'error':
      return part.message.toLowerCase().includes('http') ? [part.message] : [];
    default:
      return [];
  }
};

const clipExcerpt = (value: string): string =>
  value.length > 180 ? `${value.slice(0, 177)}…` : value;

const excerptIn = (
  text: string,
  url: string,
  id: PrIdentity | undefined,
): string => {
  let at = text.indexOf(url);
  if (at < 0 && id !== undefined) at = text.indexOf(id.path);
  if (at < 0) return '';
  const label = markdownLabel(text, at);
  const repo = id?.repo ?? '';
  const number = id?.number ?? 0;
  if (label !== undefined && !isWeakPrTitle(label, repo, number))
    return clipExcerpt(label);
  const start = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  let end = text.indexOf('\n', at);
  if (end < 0) end = text.length;
  const line = text
    .slice(start, end)
    .replace(url, '')
    .replace(/\[[^\]]*\]\(\s*\)/g, '')
    .replace(/[()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:.,]+|[\s\-–—:.,]+$/g, '')
    .trim();
  if (line.length >= 12 && !isWeakPrTitle(line, repo, number))
    return clipExcerpt(line);
  return '';
};

/** Short line to show for one message that mentions `url`. Empty when the
 * message has no usable sentence — the UI supplies its own fallback. */
export const mentionExcerpt = (entry: MessageEntry, url: string): string => {
  const id = prIdentityFromUrl(url);
  for (const part of entry.parts) {
    for (const text of partTexts(part)) {
      const excerpt = excerptIn(text, url, id);
      if (excerpt !== '') return excerpt;
    }
  }
  return '';
};

/** PRs found in one entry, in document order. */
export const detectEntryPrs = (entry: MessageEntry): ChangeRequestSummary[] => {
  const out: ChangeRequestSummary[] = [];
  for (const part of entry.parts) {
    for (const text of partTexts(part)) {
      URL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = URL_RE.exec(text)) !== null) {
        const summary = classify(m[0], markdownLabel(text, m.index));
        if (summary !== undefined) out.push(summary);
      }
    }
  }
  return out;
};

const mentionsRole = (role: MessageEntry['role']): boolean =>
  role === 'assistant' || role === 'user';

const absorbPr = (
  out: ChangeRequestSummary[],
  index: Map<string, number>,
  pr: ChangeRequestSummary,
): void => {
  const key = prIdentityKey(pr);
  const at = index.get(key);
  if (at === undefined) {
    index.set(key, out.length);
    out.push(pr);
    return;
  }
  const prev = out[at];
  const id = prIdentityFromUrl(prev.url) ?? prIdentityFromUrl(pr.url);
  const number = prev.number > 0 ? prev.number : pr.number;
  out[at] = {
    ...prev,
    number,
    provider: prev.provider !== '' ? prev.provider : pr.provider,
    title: preferTitle(prev.title, pr.title, id?.repo ?? '', number),
    url: preferPrUrl(prev.url, pr.url),
  };
};

const collectMentioned = (
  entries: readonly MessageEntry[],
  prsFor: (entry: MessageEntry) => readonly ChangeRequestSummary[],
): ChangeRequestSummary[] => {
  const out: ChangeRequestSummary[] = [];
  const index = new Map<string, number>();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!mentionsRole(entry.role)) continue;
    const found = prsFor(entry);
    for (let j = found.length - 1; j >= 0; j--) absorbPr(out, index, found[j]);
  }
  return out;
};

/**
 * PR/MR URLs in this thread, newest first. The same request linked as
 * `/pull/19`, `/pull/19/files`, or a GitHub API `/pulls/19` URL is one row.
 * User and assistant messages count; system messages do not.
 */
export const detectThreadPrs = (
  entries: readonly MessageEntry[],
): ChangeRequestSummary[] => collectMentioned(entries, detectEntryPrs);

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

const textHash = (text: string, seed: number): number => {
  let hash = seed;
  for (let i = 0; i < text.length; i++)
    hash = (hash * 33 + text.charCodeAt(i)) % 2147483647;
  return hash;
};

/**
 * Incremental per-entry cache. Streaming re-projects `entries` constantly;
 * settled entries are immutable, so only the changed tail is re-scanned.
 * The fingerprint includes a text hash so a same-length edit still rescans.
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
    let hash = 5381;
    for (const part of entry.parts) {
      for (const text of partTexts(part)) {
        len += text.length;
        hash = textHash(text, hash);
      }
    }
    return `${entry.id}:${entry.status ?? ''}:${
      entry.parts.length
    }:${len}:${hash}`;
  }

  scan(entries: readonly MessageEntry[]): ChangeRequestSummary[] {
    const alive = new Set<string>();
    for (const entry of entries) {
      alive.add(entry.id);
      if (!mentionsRole(entry.role)) continue;
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
    return collectMentioned(
      entries,
      entry => this.cache.get(entry.id)?.prs ?? [],
    );
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
