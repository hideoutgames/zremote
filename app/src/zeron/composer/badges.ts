// Inline composer badges. The draft stores canonical
// `[label](zeron-invoke:…)` / `[label](zeron-file:…)` links. The TextInput
// shows the short label (`/name`, `$name`, `@file`) so a pill can sit on
// those exact glyphs. Typing a full name and leaving the token (space,
// punctuation, or send) commits the same link autocomplete would insert.
import { splitTextEdit } from '../attachments/paste';
import {
  fileMentionLinks,
  invocationLinks,
  localFileLink,
  localPathIsSafe,
  type Invocation,
} from '../protocol/references';
import type { FileSearchMatch } from '../protocol/types';
import {
  invocationInsertion,
  invocationToken,
  mentionToken,
  type InvocationCandidate,
} from './completion';

export type BadgeKind = 'command' | 'skill' | 'file';

export interface ComposerRun {
  text: string;
  kind?: BadgeKind;
}

export interface BadgeSpan {
  displayStart: number;
  displayEnd: number;
  canonicalStart: number;
  canonicalEnd: number;
  kind: BadgeKind;
}

export interface ComposerSurface {
  display: string;
  runs: ComposerRun[];
  spans: BadgeSpan[];
}

const badgeLabel = (kind: BadgeKind, name: string): string => {
  if (kind === 'file') return `@${name}`;
  if (kind === 'skill') return `$${name}`;
  return `/${name}`;
};

/** Canonical draft → the string the composer paints and edits. */
export function composerSurface(canonical: string): ComposerSurface {
  const marks: {
    start: number;
    end: number;
    kind: BadgeKind;
    name: string;
  }[] = [
    ...invocationLinks(canonical).map(link => ({
      start: link.start,
      end: link.end,
      kind: (link.invocation.kind === 'skill'
        ? 'skill'
        : 'command') as BadgeKind,
      name: link.invocation.name,
    })),
    ...fileMentionLinks(canonical).map(link => ({
      start: link.start,
      end: link.end,
      kind: 'file' as const,
      name: link.basename,
    })),
  ].sort((a, b) => a.start - b.start);

  const runs: ComposerRun[] = [];
  const spans: BadgeSpan[] = [];
  let display = '';
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) {
      const text = canonical.slice(cursor, mark.start);
      runs.push({ text });
      display += text;
    }
    const label = badgeLabel(mark.kind, mark.name);
    const displayStart = display.length;
    display += label;
    runs.push({ text: label, kind: mark.kind });
    spans.push({
      displayStart,
      displayEnd: display.length,
      canonicalStart: mark.start,
      canonicalEnd: mark.end,
      kind: mark.kind,
    });
    cursor = mark.end;
  }
  if (cursor < canonical.length) {
    const text = canonical.slice(cursor);
    runs.push({ text });
    display += text;
  }
  return { display, runs, spans };
}

/** Display caret → index in the canonical draft. Interior of a badge snaps
 * to the canonical end so completion does not scan the link payload. */
export function displayToCanonical(
  surface: ComposerSurface,
  index: number,
): number {
  const at = Math.max(0, Math.min(index, surface.display.length));
  let delta = 0;
  for (const span of surface.spans) {
    if (at <= span.displayStart) return at + delta;
    if (at < span.displayEnd) return span.canonicalEnd;
    delta = span.canonicalEnd - span.displayEnd;
  }
  return at + delta;
}

/** Canonical caret → index in the display string. */
export function canonicalToDisplay(
  surface: ComposerSurface,
  index: number,
): number {
  const at = Math.max(0, index);
  let delta = 0;
  for (const span of surface.spans) {
    if (at <= span.canonicalStart) return Math.max(0, at - delta);
    if (at < span.canonicalEnd) return span.displayEnd;
    delta = span.canonicalEnd - span.displayEnd;
  }
  return Math.max(0, at - delta);
}

/**
 * Apply a TextInput edit (display coordinates) to the canonical draft.
 * A badge is atomic: an edit that touches its interior removes the whole link.
 */
export function applyDisplayEdit(
  canonical: string,
  nextDisplay: string,
): string {
  const surface = composerSurface(canonical);
  if (surface.display === nextDisplay) return canonical;
  const edit = splitTextEdit(surface.display, nextDisplay);
  let start = edit.prefix.length;
  let end = surface.display.length - edit.suffix.length;
  for (const span of surface.spans) {
    const touches =
      (start === end && start > span.displayStart && start < span.displayEnd) ||
      (start < span.displayEnd && end > span.displayStart);
    if (!touches) continue;
    start = Math.min(start, span.displayStart);
    end = Math.max(end, span.displayEnd);
  }
  const cStart = displayToCanonical(surface, start);
  const cEnd = displayToCanonical(surface, end);
  return canonical.slice(0, cStart) + edit.inserted + canonical.slice(cEnd);
}

export interface CommitExactOptions {
  rows: InvocationCandidate[];
  /** Codex keeps skills off the `/` menu; other harnesses include them. */
  includeSkillsInSlash: boolean;
  dollarSkills: boolean;
  mentionResults: FileSearchMatch[];
  /** Query the current `@` search was run for; basename matches require it. */
  mentionQuery?: string;
  /** Commit a token that runs to the end of the text (send, no trailing space). */
  atEnd: boolean;
  supported: boolean;
  /** Canonical caret to keep stable across replacements. */
  caret?: number;
}

const matchInvocation = (
  query: string,
  prefix: '/' | '$',
  options: CommitExactOptions,
): Invocation | undefined => {
  const rows = options.rows.filter(row => row.workspaceCommand === undefined);
  if (prefix === '$') {
    if (!options.dollarSkills) return undefined;
    return rows.find(
      row => row.invocation.kind === 'skill' && row.name === query,
    )?.invocation;
  }
  const command = rows.find(
    row => row.invocation.kind === 'command' && row.name === query,
  );
  if (command !== undefined) return command.invocation;
  if (!options.includeSkillsInSlash) return undefined;
  return rows.find(row => row.invocation.kind === 'skill' && row.name === query)
    ?.invocation;
};

const matchFile = (
  query: string,
  options: CommitExactOptions,
): { path: string; isDir: boolean } | undefined => {
  const results = options.mentionQuery === query ? options.mentionResults : [];
  const exact = results.find(row => row.path === query);
  if (exact !== undefined) return exact;
  const base = results.filter(
    row => (row.path.split('/').pop() ?? row.path) === query,
  );
  if (base.length === 1) return base[0];
  const trimmed = query.replace(/\/+$/, '');
  const isDir = query.endsWith('/') && trimmed.length < query.length;
  if (query.includes('/') && localPathIsSafe(trimmed))
    return { path: trimmed, isDir };
  return undefined;
};

interface PendingCommit {
  start: number;
  end: number;
  insertion: string;
}

const closedToken = (
  text: string,
  start: number,
  end: number,
  atEnd: boolean,
): boolean =>
  end < text.length || (atEnd && end === text.length && end > start);

/** Closed `/name`, `$name`, and `@file` tokens → canonical links. */
export function commitExactReferences(
  text: string,
  options: CommitExactOptions,
): { text: string; caret: number } {
  const pending: PendingCommit[] = [];

  const probeInvocation = (prefix: '/' | '$') => {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== prefix) continue;
      if (i + 1 > text.length) continue;
      const seed = invocationToken(text, Math.min(text.length, i + 1), prefix);
      if (seed === undefined || seed.start !== i) continue;
      const token = invocationToken(text, seed.end, prefix);
      if (
        token === undefined ||
        token.start !== i ||
        token.query === '' ||
        token.end !== seed.end
      )
        continue;
      if (!closedToken(text, token.start, token.end, options.atEnd)) continue;
      const invocation = matchInvocation(token.query, prefix, options);
      if (invocation === undefined) continue;
      pending.push({
        start: token.start,
        end: token.end,
        insertion: invocationInsertion(invocation, options.supported),
      });
      i = token.end;
    }
  };
  probeInvocation('/');
  probeInvocation('$');

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    if (i + 1 > text.length) continue;
    const seed = mentionToken(text, Math.min(text.length, i + 1));
    if (seed === undefined || seed.start !== i) continue;
    const token = mentionToken(text, seed.end);
    if (
      token === undefined ||
      token.start !== i ||
      token.query === '' ||
      token.end !== seed.end
    )
      continue;
    if (text.slice(token.start + 1, token.end) !== token.query) continue;
    if (!closedToken(text, token.start, token.end, options.atEnd)) continue;
    const file = matchFile(token.query, options);
    if (file === undefined) continue;
    pending.push({
      start: token.start,
      end: token.end,
      insertion: localFileLink(file.path, file.isDir),
    });
    i = token.end;
  }

  let out = text;
  let caret = options.caret ?? text.length;
  for (const item of pending.sort((a, b) => b.start - a.start)) {
    const next =
      out.slice(0, item.start) + item.insertion + out.slice(item.end);
    const grew = item.insertion.length - (item.end - item.start);
    if (caret >= item.end) caret += grew;
    else if (caret > item.start) caret = item.start + item.insertion.length;
    out = next;
  }
  return { text: out, caret };
}
