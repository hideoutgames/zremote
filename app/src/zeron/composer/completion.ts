// Composer completion logic — a TypeScript port of Zeron desktop's
// crates/ui/src/composer.rs token parsing, candidate merging, insertion, and
// send-gating so `/` commands, `$` skills, and `@` files behave identically.
import { t } from '../../i18n/strings';
import { RelayError } from '../transport/deviceRelayClient';
import {
  fileMentionLinks,
  invocationLinks,
  invocationLink,
  invocationPromptText,
  localPathIsSafe,
  nativeSkillIdentity,
  validInvocationName,
  validSkillCommandName,
  validSkillPath,
  inFence,
  inInlineCode,
  type Invocation,
  type Skill,
} from '../protocol/references';
import type { HarnessId, SlashCommand } from '../protocol/types';

export interface CompletionToken {
  start: number;
  end: number;
  query: string;
}

const isWhitespace = (ch: string): boolean => /\p{White_Space}/u.test(ch);
const isAlnum = (ch: string): boolean => /[\p{L}\p{N}\p{Alphabetic}]/u.test(ch);
const isMark = (ch: string): boolean => /\p{M}/u.test(ch);
const BOUNDARY = '([{>';

const lastChar = (s: string): string | undefined => {
  const chars = [...s];
  return chars.length === 0 ? undefined : chars[chars.length - 1];
};

function lastWhitespaceEnd(text: string, cursor: number): number {
  let out = 0;
  let i = 0;
  for (const ch of text.slice(0, cursor)) {
    if (isWhitespace(ch)) out = i + ch.length;
    i += ch.length;
  }
  return out;
}

/**
 * Refine a locally identified token using Markdown structure — rejects tokens
 * inside code, links, reference definitions, unfinished link destinations,
 * and non-blockquote `>` positions (composer.rs `completion_markdown_end` +
 * `in_code`, minus the pulldown-cmark dependency).
 */
export function completionMarkdownEnd(
  text: string,
  start: number,
  cursor: number,
  end: number,
): number | null {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;

  // `>` immediately before the token must be a blockquote boundary: only
  // '>' / spaces / tabs between the line start and the token.
  if (start > 0 && text[start - 1] === '>') {
    for (let i = lineStart; i < start; i++) {
      const c = text[i];
      if (c !== '>' && c !== ' ' && c !== '\t') return null;
    }
  }

  // Reference definitions: `[label]: dest` line containing the token.
  const nl = text.indexOf('\n', start);
  const lineEnd = nl < 0 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  if (/^ {0,3}\[[^\]\n]*\]:/.test(line)) return null;

  // Code: fenced block containing the cursor, an indented code line
  // (≥4 spaces or a tab), or an unclosed inline `code` span before the token.
  if (inFence(text, cursor)) return null;
  if (/^( {4}|\t)/.test(line)) return null;
  const parStart = paragraphStart(text, lineStart);
  if (inInlineCode(text, parStart, start)) return null;

  // Inside a finished `[label](dest)` / `![label](dest)` — the paragraph's
  // links are rescanned and any whose range contains the token rejects it.
  if (linkRangeCovers(text, parStart, start)) return null;

  // An unfinished `](` destination still open at the cursor.
  if (openLinkDestination(text, parStart, cursor, start)) return null;

  // Inside `*em*` / `**strong**` / `~~strike~~` the token's end clamps to the
  // closing delimiter so the insertion lands inside the emphasis (cursor
  // already past the closer rejects).
  const clamp = emphasisClampEnd(text, parStart, start, cursor, end);
  if (clamp === null) return null;
  return clamp;
}

/**
 * Minimal emphasis pairing for `completion_markdown_end`'s clamp: pairs runs
 * of `*` / `_` / `~` in the paragraph, `_`-family runs following cmark's
 * intraword exemption (can't open after, or close before, an alphanumeric).
 * Returns `end` clamped to the earliest closing delimiter covering `start`,
 * or null when the cursor sits past it.
 */
function emphasisClampEnd(
  text: string,
  parStart: number,
  start: number,
  cursor: number,
  end: number,
): number | null {
  let clamp = end;
  const alnumAt = (i: number) =>
    i >= 0 && i < text.length && /[\p{L}\p{N}]/u.test(text[i]);
  for (const ch of ['*', '_', '~']) {
    // Collect maximal runs of `ch` from the paragraph start onward.
    const runs: { at: number; len: number }[] = [];
    for (let i = parStart; i < text.length; ) {
      if (text[i] !== ch) {
        i++;
        continue;
      }
      let j = i;
      while (text[j] === ch) j++;
      runs.push({ at: i, len: Math.min(j - i, 2) });
      i = j;
    }
    // Pair runs sequentially; a `_` run can't open after alphanumeric text
    // and can't close before it (cmark intraword rule, approximated).
    let open: { at: number; len: number } | undefined;
    for (const run of runs) {
      if (open === undefined) {
        if (run.at > start) break;
        if (ch === '_' && alnumAt(run.at - 1)) continue;
        open = run;
        continue;
      }
      const closing = run.at;
      const rangeEnd = closing + run.len;
      if (start >= open.at && start < rangeEnd) {
        if (ch === '_' && alnumAt(closing + run.len)) {
          open = undefined;
          continue;
        }
        if (cursor > closing) return null;
        clamp = Math.min(clamp, closing);
        break;
      }
      // Pair ended before the token — the closer becomes the next opener.
      open = undefined;
    }
  }
  return clamp;
}

/** Start of the paragraph containing `lineStart` (first line after a blank). */
function paragraphStart(text: string, lineStart: number): number {
  let i = lineStart;
  while (i > 0) {
    const prevStart = text.lastIndexOf('\n', i - 2) + 1;
    if (text.slice(prevStart, i - 1).trim() === '') break;
    i = prevStart;
  }
  return i;
}

/** True when a `[..](..)`/`![..](..)` range in the paragraph covers `pos`. */
function linkRangeCovers(text: string, from: number, pos: number): boolean {
  let i = from;
  while (i < text.length && i <= pos) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    const isImage = c === '!' && text[i + 1] === '[';
    if (c === '[' || isImage) {
      const lb = isImage ? i + 1 : i;
      const rb = closeBracket(text, lb);
      if (rb > 0 && text[rb + 1] === '(') {
        const rp = closeParen(text, rb + 1);
        if (rp < 0) return pos > rb + 1;
        if (pos >= i && pos < rp) return true;
        i = rp;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return false;
}

function closeBracket(text: string, lb: number): number {
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

function closeParen(text: string, openParen: number): number {
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

/** True when an unfinished `](` destination reaches `cursor` past `start`. */
function openLinkDestination(
  text: string,
  parStart: number,
  cursor: number,
  tokenStart: number,
): boolean {
  const before = text.slice(parStart, cursor);
  for (
    let m = before.lastIndexOf('](');
    m >= 0;
    m = before.lastIndexOf('](', m - 1)
  ) {
    const label = before.lastIndexOf('[', m);
    if (label < 0) continue;
    const escaped = (at: number): boolean => {
      let run = 0;
      for (let j = at - 1; j >= 0 && before[j] === '\\'; j--) run++;
      return run % 2 === 1;
    };
    if (escaped(label) || escaped(m)) continue;
    if (parStart + m + 2 > tokenStart) continue;
    // Paren depth from just after `(` to the end of `before`.
    let depth = 1;
    for (let i = m + 2; i < before.length && depth > 0; i++) {
      const c = before[i];
      if (c === '\\') i++;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    if (depth > 0) return true;
  }
  return false;
}

/** `@` token: after whitespace, or a `(`/`[`/`{`/`>` boundary char. */
export function mentionToken(
  text: string,
  cursor: number,
): CompletionToken | undefined {
  if (cursor > text.length) return undefined;
  const tokenStart = lastWhitespaceEnd(text, cursor);
  const relAt = text.slice(tokenStart, cursor).lastIndexOf('@');
  if (relAt < 0) return undefined;
  const at = tokenStart + relAt;
  const prev = lastChar(text.slice(0, at));
  const validBoundary =
    at === 0 ||
    (prev !== undefined && (isWhitespace(prev) || BOUNDARY.includes(prev)));
  if (text.slice(at + 1, cursor).includes('@') || !validBoundary)
    return undefined;
  const closing =
    prev === '(' ? ')' : prev === '[' ? ']' : prev === '{' ? '}' : undefined;
  let end = text.length;
  for (let i = cursor; i < text.length; i++) {
    const c = text[i];
    if (isWhitespace(c) || c === closing) {
      end = i;
      break;
    }
  }
  if (closing !== undefined && text.slice(at + 1, cursor).includes(closing))
    return undefined;
  const mdEnd = completionMarkdownEnd(text, at, cursor, end);
  if (mdEnd === null) return undefined;
  return { start: at, end: mdEnd, query: text.slice(at + 1, cursor) };
}

function nameCharOk(ch: string, prevOk: boolean): boolean {
  if (isAlnum(ch) || '-_:.'.includes(ch)) return true;
  // Combining marks extend a grapheme whose base char is a name char.
  return isMark(ch) && prevOk;
}

function scanNameEnd(text: string, from: number): number {
  let i = from;
  let prevOk = true;
  for (const ch of text.slice(from)) {
    const ok = nameCharOk(ch, prevOk);
    if (!ok) break;
    prevOk = ok;
    i += ch.length;
  }
  return i;
}

/** `/` or `$` invocation token at the cursor (composer.rs `invocation_token`). */
export function invocationToken(
  text: string,
  cursor: number,
  prefix: '/' | '$',
): CompletionToken | undefined {
  if (cursor > text.length) return undefined;
  let start = 0;
  {
    let i = 0;
    for (const ch of text.slice(0, cursor)) {
      if (isWhitespace(ch) || BOUNDARY.includes(ch)) start = i + ch.length;
      i += ch.length;
    }
  }
  if (text[start] !== prefix) return undefined;
  const query = text.slice(start + 1, cursor);
  {
    let prevOk = true;
    for (const ch of query) {
      const ok = nameCharOk(ch, prevOk);
      if (!ok) return undefined;
      prevOk = ok;
    }
    if (prefix === '$' && query.length > 0 && /\p{N}/u.test(query[0]))
      return undefined;
  }
  let end = scanNameEnd(text, start + 1);
  if (text[end] === '/') return undefined;
  const mdEnd = completionMarkdownEnd(text, start, cursor, end);
  if (mdEnd === null) return undefined;
  end = mdEnd;
  return { start, end, query };
}

/** `/`-prefixed invocation token (composer.rs `slash_token`). */
export const slashToken = (
  text: string,
  cursor: number,
): CompletionToken | undefined => invocationToken(text, cursor, '/');

// ── Skill-completion preferences (settings.rs SkillCompletionSettings) ─────

/**
 * `skill_display_name` — last `:` segment, `-`/`_`/whitespace-separated
 * words title-cased (desktop composer.rs).
 */
export function skillDisplayName(name: string): string {
  const segment = name.split(':').pop() ?? name;
  return segment
    .split(/[-_\s]+/)
    .filter(word => word.length > 0)
    .map(word => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export interface SkillPrefs {
  dollar: boolean;
  separateFromSlash: boolean;
}

/** Desktop default: only Codex gets a separate `$` trigger and `/`-split menu. */
export function skillPrefsForHarness(
  harness: HarnessId | undefined,
): SkillPrefs {
  const native = harness === 'codex';
  return { dollar: native, separateFromSlash: native };
}

export interface CompletionTrigger {
  token: CompletionToken | undefined;
  skill: boolean;
  includeSkills: boolean;
  commandsAllowed: boolean;
}

export function completionTrigger(
  text: string,
  cursor: number,
  prefs: SkillPrefs,
): CompletionTrigger {
  const skillToken = prefs.dollar
    ? invocationToken(text, cursor, '$')
    : undefined;
  const skill = skillToken !== undefined;
  const includeSkills = skill || !prefs.separateFromSlash;
  const token = skillToken ?? slashToken(text, cursor);
  const commandsAllowed = token !== undefined && !skill;
  return { token, skill, includeSkills, commandsAllowed };
}

// ── Menu primitives (popover.rs) ───────────────────────────────────────────

export function menuStep(
  active: number | undefined,
  count: number,
  delta: number,
): number | undefined {
  if (count === 0) return undefined;
  if (active === undefined) return delta >= 0 ? 0 : count - 1;
  return (((active + delta) % count) + count) % count;
}

/** `0` prefix match, `1` substring/empty, `undefined` no match. */
export function matchRank(query: string, label: string): number | undefined {
  const q = query.trim().toLowerCase();
  if (q === '') return 1;
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  if (l.includes(q)) return 1;
  return undefined;
}

export function filterIndices(query: string, labels: string[]): number[] {
  return labels
    .map((label, ix) => {
      const rank = matchRank(query, label);
      return rank === undefined ? -1 : rank * labels.length + ix;
    })
    .map((key, ix) => ({ key, ix }))
    .filter(({ key }) => key >= 0)
    .sort((a, b) => a.key - b.key)
    .map(({ ix }) => ix);
}

// ── Insertion (composer.rs reference_suffix / replace_*) ───────────────────

const NO_SUFFIX = new Set([
  ')',
  ']',
  '}',
  '*',
  '_',
  '~',
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
]);

/** `(trailing insertion, extra caret advance)` for the char after the token. */
export function referenceSuffix(next: string | undefined): [string, number] {
  if (next === undefined) return [' ', 0];
  if (next === '\n' || next === '\r') return ['', 0];
  if (isWhitespace(next)) return ['', next.length];
  if (NO_SUFFIX.has(next)) return ['', 0];
  return [' ', 0];
}

/** Result of replacing `token` in `text` with `insertion` + reference suffix. */
export function replaceCompletionToken(
  text: string,
  token: CompletionToken,
  insertion: string,
): { text: string; cursor: number } {
  const next = text.slice(token.end, token.end + 1) || undefined;
  const nextCp = next === undefined ? undefined : [...next][0];
  const [trailing, advance] = referenceSuffix(nextCp);
  const inserted = insertion + trailing;
  const newText = text.slice(0, token.start) + inserted + text.slice(token.end);
  const cursor = token.start + inserted.length + advance;
  return { text: newText, cursor };
}

/** Remove the token for a workspace command (whole text when sole content). */
export function removeCompletionToken(
  text: string,
  token: CompletionToken,
): string {
  let { start, end } = token;
  if (text.slice(0, start).trim() === '' && text.slice(end).trim() === '') {
    start = 0;
    end = text.length;
  } else if (
    (start === 0 || text.slice(0, start).endsWith(' ')) &&
    text.slice(end).startsWith(' ')
  ) {
    end += 1;
  }
  return text.slice(0, start) + text.slice(end);
}

// ── Workspace commands (composer.rs WorkspaceCommand) ──────────────────────

export type WorkspaceCommand =
  | 'model'
  | 'new'
  | 'resume'
  | 'settings'
  | 'diff'
  | 'files'
  | 'terminal'
  | 'rename'
  | 'stop';

interface WorkspaceCatalogRow {
  command: WorkspaceCommand;
  name: string;
  description: () => string;
  inChatOnly: boolean;
}

const WORKSPACE_CATALOG: WorkspaceCatalogRow[] = [
  {
    command: 'model',
    name: 'model',
    description: () => t('composer.cmd.model'),
    inChatOnly: false,
  },
  {
    command: 'new',
    name: 'new',
    description: () => t('composer.cmd.new'),
    inChatOnly: false,
  },
  {
    command: 'resume',
    name: 'resume',
    description: () => t('composer.cmd.resume'),
    inChatOnly: false,
  },
  {
    command: 'settings',
    name: 'settings',
    description: () => t('composer.cmd.settings'),
    inChatOnly: false,
  },
  {
    command: 'diff',
    name: 'diff',
    description: () => t('composer.cmd.diff'),
    inChatOnly: true,
  },
  {
    command: 'files',
    name: 'files',
    description: () => t('composer.cmd.files'),
    inChatOnly: true,
  },
  {
    command: 'terminal',
    name: 'terminal',
    description: () => t('composer.cmd.terminal'),
    inChatOnly: true,
  },
  {
    command: 'rename',
    name: 'rename',
    description: () => t('composer.cmd.rename'),
    inChatOnly: true,
  },
  {
    command: 'stop',
    name: 'stop',
    description: () => t('composer.cmd.stop'),
    inChatOnly: true,
  },
];

export interface InvocationCandidate {
  workspaceCommand?: WorkspaceCommand;
  name: string;
  description: string;
  inputHint?: string;
  invocation: Invocation;
}

/** Append Zeron's own commands, `zeron:`-prefixing provider name collisions. */
export function withWorkspaceCommands(
  rows: InvocationCandidate[],
  inChat: boolean,
): InvocationCandidate[] {
  const kept = rows.filter(row => row.workspaceCommand === undefined);
  for (const row of WORKSPACE_CATALOG) {
    if (row.inChatOnly && !inChat) continue;
    let name = row.name;
    while (kept.some(r => r.name === name)) name = `zeron:${name}`;
    kept.push({
      workspaceCommand: row.command,
      name,
      description: row.description(),
      invocation: { kind: 'command', name },
    });
  }
  return kept;
}

/** Whole-text `/name` → the workspace command, when the row has one. */
export function workspaceCommandForText(
  text: string,
  rows: InvocationCandidate[],
): WorkspaceCommand | undefined {
  const end = text.trimEnd().length;
  const token = slashToken(text, end);
  if (token === undefined) return undefined;
  if (text.slice(0, token.start).trim() !== '') return undefined;
  return rows.find(row => row.name === token.query)?.workspaceCommand;
}

// ── Candidate building (composer.rs invocation_candidates / merge) ─────────

export function invocationCandidates(
  commands: SlashCommand[],
  skills: Skill[],
): InvocationCandidate[] {
  const validSkills = skills.filter(
    s =>
      validInvocationName(s.name) &&
      validSkillPath(s.path) &&
      (s.command === undefined || validSkillCommandName(s.command.name)),
  );
  const skillCommands = new Set(
    validSkills
      .map(s => s.command?.name)
      .filter((n): n is string => n !== undefined),
  );
  const validCommands = commands.filter(
    c => validInvocationName(c.name) && !skillCommands.has(c.name),
  );
  return [
    ...validCommands.map(c => ({
      inputHint: c.inputHint,
      name: c.name,
      description: c.description,
      invocation: { kind: 'command', name: c.name } as Invocation,
    })),
    ...validSkills
      .filter(s => s.enabled)
      .map(s => ({
        name: s.name,
        description: nativeSkillIdentity(s.path)
          ? s.description
          : `${s.description} — ${s.path}`,
        invocation: {
          kind: 'skill',
          name: s.name,
          path: s.path,
          command: s.command,
        } as Invocation,
      })),
  ];
}

export interface MergedCatalog {
  candidates: InvocationCandidate[];
  supported: boolean;
  warning?: string;
}

export function mergeInvocationResults(
  commands: SlashCommand[] | Error,
  skills: Skill[] | undefined | Error,
  skillOnly: boolean,
): MergedCatalog | Error {
  const cmdsOk = !Array.isArray(commands) ? undefined : commands;
  const cmdsErr = Array.isArray(commands) ? undefined : commands;
  const skillsOk = skills instanceof Error ? undefined : skills;
  const skillsErr = skills instanceof Error ? skills : undefined;

  if (cmdsOk !== undefined && skillsErr === undefined)
    return {
      candidates: invocationCandidates(cmdsOk, skillsOk ?? []),
      supported: !skillOnly || skillsOk !== undefined,
    };
  if (
    cmdsOk !== undefined &&
    skillsErr !== undefined &&
    !skillOnly &&
    cmdsOk.length > 0
  )
    return {
      candidates: invocationCandidates(cmdsOk, []),
      supported: true,
      warning: slashErrorMessage(skillsErr, true),
    };
  if (
    cmdsErr !== undefined &&
    skillsOk !== undefined &&
    skillsOk.some(s => s.enabled)
  )
    return {
      candidates: invocationCandidates([], skillsOk),
      supported: true,
      warning: slashErrorMessage(cmdsErr, false),
    };
  return cmdsErr ?? skillsErr ?? new Error('unknown');
}

export function isUnknownMethod(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('unknown method') || message.includes('unknownmethod')
  );
}

function isUnreachable(err: unknown): boolean {
  return (
    err instanceof RelayError &&
    (err.kind === 'notConnected' ||
      err.kind === 'hostOffline' ||
      err.kind === 'timeout')
  );
}

export function mentionErrorMessage(err: unknown): string {
  if (isUnknownMethod(err)) return t('composer.autocomplete.filesOldHost');
  if (isUnreachable(err)) return t('composer.autocomplete.deviceUnreachable');
  return t('composer.autocomplete.fileSearchFailed');
}

export function slashErrorMessage(err: unknown, skill: boolean): string {
  if (isUnknownMethod(err))
    return skill
      ? t('composer.autocomplete.skillsOldHost')
      : t('composer.autocomplete.commandsOldHost');
  if (isUnreachable(err)) return t('composer.autocomplete.deviceUnreachable');
  return skill
    ? t('composer.autocomplete.skillsFailed')
    : t('composer.autocomplete.commandsFailed');
}

// ── Insertion / send gating ────────────────────────────────────────────────

/** Canonical-link insertion for commands only when the engine understands them. */
export function invocationInsertion(
  invocation: Invocation,
  supported: boolean,
): string {
  if (!supported && invocation.kind === 'command')
    return invocationPromptText(invocation);
  return invocationLink(invocation);
}

/** True when a draft contains canonical references an old engine can't decode. */
export function referencesRequireUpdate(
  text: string,
  supported: boolean,
): boolean {
  return (
    !supported &&
    (invocationLinks(text).length > 0 || fileMentionLinks(text).length > 0)
  );
}

export { localPathIsSafe };
