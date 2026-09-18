// Turn-scoped file list: unique write/edit/patch paths on one assistant
// entry, with +/- from `diffStats` when the host attached them.

import type { MessageEntry, ToolDiff } from '../../zeron/protocol/types';

export interface TurnChange {
  path: string;
  additions: number;
  deletions: number;
  diff?: ToolDiff;
}

const rec = (call: object): Record<string, unknown> =>
  call as Record<string, unknown>;

const str = (call: Record<string, unknown>, key: string): string => {
  const v = call[key];
  return typeof v === 'string' ? v : '';
};

const EDIT_KINDS = new Set(['writeFile', 'editFile', 'applyPatch']);

const pathsOf = (call: Record<string, unknown>): string[] => {
  const kind = str(call, 'kind');
  if (!EDIT_KINDS.has(kind)) return [];
  if (kind === 'applyPatch') {
    const changes = call.changes;
    if (Array.isArray(changes)) {
      const fromChanges = changes
        .map(c =>
          c !== null && typeof c === 'object'
            ? str(c as Record<string, unknown>, 'path')
            : '',
        )
        .filter(p => p !== '');
      if (fromChanges.length > 0) return fromChanges;
    }
    const p = str(call, 'path');
    return p === '' ? [] : [p];
  }
  const p = str(call, 'path');
  return p === '' ? [] : [p];
};

const leaf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const fileKindIcon = (path: string): 'doc.text' | 'doc' | 'terminal' => {
  const name = leaf(path).toLowerCase();
  if (
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.txt')
  )
    return 'doc.text';
  if (/\.(ts|tsx|js|jsx|swift|rs|py|go|rb|java|kt|c|h|m|mm|sh)$/.test(name))
    return 'terminal';
  return 'doc';
};

export const turnChanges = (entry: MessageEntry): TurnChange[] => {
  const byPath = new Map<string, TurnChange>();
  for (const part of entry.parts) {
    if (part.kind !== 'tool') continue;
    const call = rec(part.call);
    for (const path of pathsOf(call)) {
      const existing = byPath.get(path) ?? {
        path,
        additions: 0,
        deletions: 0,
      };
      if (part.diff !== undefined && existing.diff === undefined)
        existing.diff = part.diff;
      const stats = part.diffStats ?? [];
      for (const s of stats) {
        if (s.path === path || stats.length === 1) {
          existing.additions += s.additions;
          existing.deletions += s.deletions;
        }
      }
      byPath.set(path, existing);
    }
  }
  return [...byPath.values()];
};

export const isCompleteAssistant = (entry: MessageEntry): boolean =>
  entry.role === 'assistant' && entry.status === 'complete';
