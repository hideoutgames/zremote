// Canonical composer references (zeron proto invocation.rs + file_mentions.rs).
// Completion inserts `[label](zeron-invoke:<hex>)` / `[label](zeron-file:<enc>)`
// links; the engine decodes them at send, so the phone emits them verbatim.
import type { HarnessId } from './types';

export const INVOCATION_SCHEME = 'zeron-invoke:';
export const FILE_MENTION_SCHEME = 'zeron-file:';

const isControl = (ch: string): boolean => /\p{Cc}/u.test(ch);
const isWhitespace = (ch: string): boolean => /\p{White_Space}/u.test(ch);
const isAlnum = (ch: string): boolean => /[\p{L}\p{N}\p{Alphabetic}]/u.test(ch);

export function escapeLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`');
}

/** Native catalog entries may have no local skill file (plugin commands). */
export function nativeSkillIdentity(path: string): boolean {
  return (
    path.startsWith('opencode-skill:') || path.startsWith('harness-skill:')
  );
}

export function validInvocationName(name: string): boolean {
  return name !== '' && ![...name].some(c => isControl(c) || isWhitespace(c));
}

export function validSkillPath(path: string): boolean {
  return path !== '' && ![...path].some(isControl);
}

export function validSkillCommandName(name: string): boolean {
  return name !== '' && [...name].every(c => isAlnum(c) || '-_:.'.includes(c));
}

export interface SkillCommand {
  name: string;
  harness: HarnessId;
}

export interface Skill {
  name: string;
  path: string;
  description: string;
  enabled: boolean;
  command?: SkillCommand;
}

export type Invocation =
  | { kind: 'command'; name: string }
  | { kind: 'skill'; name: string; path: string; command?: SkillCommand };

export const invocationPrefix = (inv: Invocation): '/' | '$' =>
  inv.kind === 'command' ? '/' : '$';
export const invocationDetail = (inv: Invocation): string =>
  inv.kind === 'command' ? `/${inv.name}` : inv.path;

const toHex = (s: string): string =>
  [...new TextEncoder().encode(s)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

/** `[/{label}](zeron-invoke:<hex of serde JSON>)` — byte-identical to desktop. */
export function invocationLink(inv: Invocation): string {
  // serde internally-tagged enum emits `kind` first, then declared field order.
  const json = JSON.stringify(
    inv.kind === 'command'
      ? { kind: 'command', name: inv.name }
      : inv.command === undefined
      ? { kind: 'skill', name: inv.name, path: inv.path }
      : {
          kind: 'skill',
          name: inv.name,
          path: inv.path,
          command: inv.command,
        },
  );
  return `[${invocationPrefix(inv)}${escapeLabel(
    inv.name,
  )}](${INVOCATION_SCHEME}${toHex(json)})`;
}

const encodePromptPath = (path: string): string =>
  [...new TextEncoder().encode(path)]
    .map(b =>
      /[A-Za-z0-9\-._~:/]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, '0')}`,
    )
    .join('');

/** What the text would be if the harness couldn't decode canonical links. */
export function invocationPromptText(inv: Invocation): string {
  if (inv.kind === 'command') return `/${inv.name}`;
  if (nativeSkillIdentity(inv.path)) return inv.name;
  return `[$${escapeLabel(inv.name)}](${encodePromptPath(inv.path)})`;
}

export function percentEncodePath(path: string): string {
  return [...new TextEncoder().encode(path)]
    .map(b =>
      /[A-Za-z0-9\-._~/]/.test(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : `%${b.toString(16).toUpperCase().padStart(2, '0')}`,
    )
    .join('');
}

export function percentDecodePath(encoded: string): string | undefined {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      const b = parseInt(encoded.slice(i + 1, i + 3), 16);
      if (Number.isNaN(b) || i + 2 >= encoded.length) return undefined;
      bytes.push(b);
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return undefined;
  }
}

export function localFileLink(path: string, isDir: boolean): string {
  const trimmed = path.replace(/\/+$/, '');
  const basename =
    trimmed
      .split('/')
      .filter(p => p !== '')
      .pop() ?? trimmed;
  return `[${escapeLabel(basename)}](${FILE_MENTION_SCHEME}${percentEncodePath(
    `${trimmed}${isDir ? '/' : ''}`,
  )})`;
}

export function localPathIsSafe(path: string): boolean {
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    ![...path].some(isControl) &&
    !path.split('/').some(part => part === '' || part === '.' || part === '..')
  );
}

export interface FileMentionLink {
  start: number;
  end: number;
  basename: string;
  path: string;
  isDir: boolean;
}

// ── Minimal markdown-aware link scanner ────────────────────────────────────
// No CommonMark dependency ships in the app, so this approximates the ranges
// pulldown reports: fenced code blocks, inline code spans, escapes, and HTML
// comments are skipped; `[label](dest)` / `![label](dest)` ranges are reported
// with their raw destination. Image ranges suppress nested links (alt text).

interface ScannedLink {
  start: number;
  end: number;
  dest: string;
  image: boolean;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Ranges covered by fenced code blocks (each includes its boundary lines). */
export function fencedRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let open = -1;
  let fenceCh = '';
  let fenceLen = 0;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const m = FENCE_OPEN.exec(line);
    if (m !== null) {
      if (open < 0) {
        open = i;
        fenceCh = m[1][0];
        fenceLen = m[1].length;
      } else if (
        m[1][0] === fenceCh &&
        m[1].length >= fenceLen &&
        /^\s*$/.test(line.slice(m[0].length))
      ) {
        ranges.push({ start: open, end: lineEnd });
        open = -1;
      }
    }
    i = nl < 0 ? text.length : nl + 1;
  }
  if (open >= 0) ranges.push({ start: open, end: text.length });
  return ranges;
}

/** True when `pos` sits inside a fenced ``` / ~~~ block. */
export function inFence(text: string, pos: number): boolean {
  return fencedRanges(text).some(r => pos >= r.start && pos <= r.end);
}

/** True when `pos` sits inside an inline `code` span within `from..pos`. */
export function inInlineCode(text: string, from: number, pos: number): boolean {
  let openLen = 0;
  let i = from;
  while (i < pos) {
    const c = text[i];
    if (c === '\\' && openLen === 0) {
      i += 2;
      continue;
    }
    if (c === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      if (openLen === 0) openLen = n;
      else if (n === openLen) openLen = 0;
      i += n;
      continue;
    }
    i++;
  }
  return openLen !== 0;
}

/** Index of the `]` matching `[` at `lb` (balanced brackets, escapes), or -1. */
function matchBracket(text: string, lb: number): number {
  let depth = 0;
  for (let i = lb + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') depth++;
    if (c === ']') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** End index after the `)` closing `(` at `openParen`, or -1 when unclosed. */
function matchParen(text: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      if (depth === 0) return i + 1;
      depth--;
    }
  }
  return -1;
}

/** Position just past the code span opened by a `len`-backtick run at `from`. */
function findClosingTicks(
  text: string,
  from: number,
  len: number,
): number | undefined {
  let i = from;
  while (i < text.length) {
    if (text[i] === '`') {
      let n = 0;
      while (text[i + n] === '`') n++;
      if (n === len) return i + n;
      i += n;
      continue;
    }
    i++;
  }
  return undefined;
}

function scanMarkdownLinks(text: string): ScannedLink[] {
  const links: ScannedLink[] = [];
  const fences = fencedRanges(text);
  let fenceIx = 0;
  let i = 0;
  while (i < text.length) {
    while (fenceIx < fences.length && i > fences[fenceIx].end) fenceIx++;
    if (fenceIx < fences.length && i >= fences[fenceIx].start) {
      i = fences[fenceIx].end;
      continue;
    }
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      // Skip a code span opened by this run (closed by an equal-length run).
      let n = 0;
      while (text[i + n] === '`') n++;
      const close = findClosingTicks(text, i + n, n);
      i = close ?? i + n;
      continue;
    }
    if (c === '<' && text.startsWith('!--', i + 1)) {
      const close = text.indexOf('-->', i + 4);
      i = close < 0 ? text.length : close + 3;
      continue;
    }
    const isImage = c === '!' && text[i + 1] === '[';
    if (c === '[' || isImage) {
      const lb = isImage ? i + 1 : i;
      const rb = matchBracket(text, lb);
      if (rb > 0 && text[rb + 1] === '(') {
        const rp = matchParen(text, rb + 1);
        if (rp > 0) {
          links.push({
            start: i,
            end: rp,
            dest: text.slice(rb + 2, rp - 1),
            image: isImage,
          });
          i = rp;
          continue;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return links;
}

/** Canonical `zeron-invoke:` links with their decoded invocations. */
export function invocationLinks(text: string): {
  start: number;
  end: number;
  invocation: Invocation;
}[] {
  if (!text.includes(INVOCATION_SCHEME)) return [];
  const out: { start: number; end: number; invocation: Invocation }[] = [];
  for (const link of scanMarkdownLinks(text)) {
    if (link.image) continue;
    if (!link.dest.startsWith(INVOCATION_SCHEME)) continue;
    const hex = link.dest.slice(INVOCATION_SCHEME.length);
    if (hex.length % 2 !== 0 || !/^[\x20-\x7e]*$/.test(hex)) continue;
    const bytes: number[] = [];
    let bad = false;
    for (let i = 0; i < hex.length; i += 2) {
      const b = parseInt(hex.slice(i, i + 2), 16);
      if (Number.isNaN(b)) {
        bad = true;
        break;
      }
      bytes.push(b);
    }
    if (bad) continue;
    let invocation: Invocation;
    try {
      const raw = JSON.parse(
        new TextDecoder().decode(Uint8Array.from(bytes)),
      ) as Invocation;
      if (raw.kind !== 'command' && raw.kind !== 'skill') continue;
      invocation = raw;
    } catch {
      continue;
    }
    if (!validInvocationName(invocation.name)) continue;
    if (
      invocation.kind === 'skill' &&
      (!validSkillPath(invocation.path) ||
        (invocation.command !== undefined &&
          !validSkillCommandName(invocation.command.name)))
    )
      continue;
    const canonical = invocationLink(invocation);
    const source = text.slice(link.start, link.end);
    if (
      (canonical === source || canonical.replace(/\\`/g, '`') === source) &&
      (out.length === 0 || out[out.length - 1].end <= link.start)
    )
      out.push({ start: link.start, end: link.end, invocation });
  }
  return out;
}

/** Canonical `zeron-file:` mention links. */
export function fileMentionLinks(text: string): FileMentionLink[] {
  if (!text.includes(FILE_MENTION_SCHEME)) return [];
  const out: FileMentionLink[] = [];
  for (const link of scanMarkdownLinks(text)) {
    if (link.image) continue;
    if (!link.dest.startsWith(FILE_MENTION_SCHEME)) continue;
    const target = percentDecodePath(
      link.dest.slice(FILE_MENTION_SCHEME.length),
    );
    if (target === undefined) continue;
    const isDir = target.endsWith('/');
    const path = isDir ? target.slice(0, -1) : target;
    if (!localPathIsSafe(path)) continue;
    const canonical = localFileLink(path, isDir);
    const source = text.slice(link.start, link.end);
    if (canonical !== source && canonical.replace(/\\`/g, '`') !== source)
      continue;
    out.push({
      start: link.start,
      end: link.end,
      basename: path.split('/').pop() ?? path,
      path,
      isDir,
    });
  }
  return out;
}
