// Ported from zeron@853872d crates/ui/src/transcript.rs `call_block`
// (L842–901), `tool_detail` (L774–817), and `blob_detail` (L1912–1932) —
// the expandable chip body: full invocation, then result (diff → stats →
// output). Doc-resident output is capped; a sidecar fetch upgrades it.

import type {
  RenderToolCall,
  ToolDiff,
  ToolDiffStat,
} from '../../zeron/protocol/types';
import { fileDiffFromText } from '../../zeron/diff/fileDiffFromText';
import type { ParsedFileDiff } from '../../zeron/diff/parseUnified';

/** Max verbatim output/invocation lines before the counted tail (desktop). */
export const OUTPUT_DETAIL_MAX_LINES = 24;
/** Line cap for a FETCHED full output (desktop FULL_OUTPUT_MAX_LINES). */
export const FULL_OUTPUT_MAX_LINES = 400;
/** Phone-side inline-diff cap — desktop allows 600; FlashList cannot. */
export const INLINE_DIFF_MAX_LINES = 24;
/** Soft-wrap width for a long invocation line (desktop CALL_WRAP_COLS). */
export const CALL_WRAP_COLS = 80;

export type ToolDetail =
  | { kind: 'output'; lines: string[]; truncatedBy: number }
  | { kind: 'stats'; stats: ToolDiffStat[] }
  | { kind: 'diff'; file: ParsedFileDiff; truncatedBy: number };

const rec = (call: RenderToolCall): Record<string, unknown> =>
  call as Record<string, unknown>;

const str = (call: RenderToolCall, key: string): string => {
  const v = rec(call)[key];
  return typeof v === 'string' ? v : '';
};

const prettyJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
};

const todoItems = (call: RenderToolCall): { text: string; done: boolean }[] => {
  const v = rec(call).items;
  return Array.isArray(v) ? (v as { text: string; done: boolean }[]) : [];
};

/** Soft-wrap one raw line into `cols`-char chunks (code-point counted). */
export const wrapCols = (line: string, cols = CALL_WRAP_COLS): string[] => {
  const chars = [...line];
  if (chars.length <= cols) return [line];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += cols) {
    out.push(chars.slice(i, i + cols).join(''));
  }
  return out;
};

const trimTrailingBlank = (lines: string[]): string[] => {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
  return next;
};

const outputFromLines = (
  raw: string[],
  maxLines: number,
): Extract<ToolDetail, { kind: 'output' }> | undefined => {
  const lines = trimTrailingBlank(raw);
  if (lines.length === 0) return undefined;
  const truncatedBy = Math.max(0, lines.length - maxLines);
  return {
    kind: 'output',
    lines: lines.slice(0, maxLines),
    truncatedBy,
  };
};

const invocationFromText = (
  text: string,
  maxLines = OUTPUT_DETAIL_MAX_LINES,
): Extract<ToolDetail, { kind: 'output' }> | undefined =>
  outputFromLines(
    text.split('\n').flatMap(l => wrapCols(l)),
    maxLines,
  );

const outputFromText = (
  text: string,
  maxLines: number,
): Extract<ToolDetail, { kind: 'output' }> | undefined =>
  outputFromLines(text.split('\n'), maxLines);

export const truncateFileLines = (
  file: ParsedFileDiff,
  maxLines: number,
): { file: ParsedFileDiff; truncatedBy: number } => {
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  if (total <= maxLines) return { file, truncatedBy: 0 };
  let kept = 0;
  const hunks: ParsedFileDiff['hunks'] = [];
  for (const h of file.hunks) {
    if (kept >= maxLines) break;
    const room = maxLines - kept;
    if (h.lines.length <= room) {
      hunks.push(h);
      kept += h.lines.length;
    } else {
      hunks.push({ ...h, lines: h.lines.slice(0, room) });
      kept += room;
    }
  }
  return { file: { ...file, hunks }, truncatedBy: total - kept };
};

/** Compact byte size for the fetch affordance ("812 B", "12 KB"). */
export const formatKb = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;

/** Last path segment of a doc sidecar ref (`{chatId}/{partId}[.diff]`). */
export const blobPartId = (ref: string): string => {
  const i = ref.lastIndexOf('/');
  return i >= 0 ? ref.slice(i + 1) : ref;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const parseToolDiffJson = (text: string): ToolDiff | undefined => {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObj(v)) return undefined;
    const path = typeof v.path === 'string' ? v.path : undefined;
    const newText = typeof v.newText === 'string' ? v.newText : undefined;
    if (path === undefined || newText === undefined) return undefined;
    const oldText = typeof v.oldText === 'string' ? v.oldText : undefined;
    return oldText !== undefined
      ? { path, oldText, newText }
      : { path, newText };
  } catch {
    return undefined;
  }
};

/** Full-invocation block — what the chip header truncates to one line. */
export const callBlock = (call: RenderToolCall): ToolDetail | undefined => {
  let text = '';
  switch (call.kind) {
    case 'exec':
      text = str(call, 'command');
      break;
    case 'readFile':
      text = str(call, 'path');
      break;
    case 'writeFile': {
      const path = str(call, 'path');
      const content = rec(call).content;
      text = typeof content === 'string' ? `${path}\n${content}` : path;
      break;
    }
    case 'editFile':
      text = str(call, 'path');
      break;
    case 'applyPatch':
      text = str(call, 'path') || 'workspace';
      break;
    case 'search':
      text =
        str(call, 'path') !== ''
          ? `${str(call, 'pattern')} in ${str(call, 'path')}`
          : str(call, 'pattern');
      break;
    case 'glob':
      text = str(call, 'pattern');
      break;
    case 'webFetch': {
      const url = str(call, 'url');
      const prompt = rec(call).prompt;
      text = typeof prompt === 'string' ? `${url}\n${prompt}` : url;
      break;
    }
    case 'webSearch':
      text = str(call, 'query');
      break;
    case 'todo':
      text = todoItems(call)
        .map(i => `${i.done ? '[x]' : '[ ]'} ${i.text}`)
        .join('\n');
      break;
    case 'mcp': {
      const head = `${str(call, 'server')} · ${str(call, 'tool')}`;
      const input = rec(call).input;
      text =
        input !== undefined && input !== null
          ? `${head}\n${prettyJson(input)}`
          : head;
      break;
    }
    default: {
      const name = str(call, 'name');
      const input = rec(call).input;
      text =
        input !== undefined && input !== null
          ? `${name}\n${prettyJson(input)}`
          : name;
      break;
    }
  }
  return invocationFromText(text);
};

/** Result body: inline diff wins, then stats, then summarized output. */
export const toolDetail = (
  output: string | undefined,
  diff: ToolDiff | undefined,
  diffStats: ToolDiffStat[] | undefined,
): ToolDetail | undefined => {
  if (diff !== undefined) {
    const file = fileDiffFromText(diff.path, diff.oldText, diff.newText);
    if (file.hunks.length === 0) return undefined;
    const truncated = truncateFileLines(file, INLINE_DIFF_MAX_LINES);
    return {
      kind: 'diff',
      file: truncated.file,
      truncatedBy: truncated.truncatedBy,
    };
  }
  if (diffStats !== undefined && diffStats.length > 0) {
    return { kind: 'stats', stats: diffStats };
  }
  if (output === undefined) return undefined;
  return outputFromText(output, OUTPUT_DETAIL_MAX_LINES);
};

/** Upgrade from a fetched sidecar blob. Diff blobs are ToolDiff JSON. */
export const blobDetail = (
  text: string,
  isDiff: boolean,
): ToolDetail | undefined => {
  if (isDiff) {
    const diff = parseToolDiffJson(text);
    if (diff === undefined) return undefined;
    return toolDetail(undefined, diff, undefined);
  }
  return outputFromText(text, FULL_OUTPUT_MAX_LINES);
};

export const detailToText = (detail: ToolDetail): string => {
  switch (detail.kind) {
    case 'output':
      return detail.lines.join('\n');
    case 'stats':
      return detail.stats
        .map(s => `${s.path}  +${s.additions}  −${s.deletions}`)
        .join('\n');
    case 'diff':
      return detail.file.hunks
        .flatMap(h =>
          h.lines.map(l => {
            const mark = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
            return `${mark}${l.text}`;
          }),
        )
        .join('\n');
  }
};

/** Clipboard payload: invocation, then the visible result. */
export const toolCopyText = (
  invocation: ToolDetail | undefined,
  result: ToolDetail | undefined,
): string =>
  [invocation, result]
    .filter((d): d is ToolDetail => d !== undefined)
    .map(detailToText)
    .filter(s => s !== '')
    .join('\n\n');
