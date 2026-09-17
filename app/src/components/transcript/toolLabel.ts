// Ported from zeron@853872d crates/proto/src/view.rs `tool_chip_content` /
// `tool_chip_content_raw` (L400–440) and `tool_group_summary` (L446–515) —
// one label+detail per tool call, and the "Ran 3 commands · edited 2 files"
// group summary.

import type { RenderToolCall } from '../../zeron/protocol/types';
import type { SFSymbol } from 'sf-symbols-typescript';

const singleLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim();

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** (label, detail) for one tool call — the chip's two lines. */
export const toolChipContent = (
  call: RenderToolCall,
): { label: string; detail: string } => {
  const [label, detail] = toolChipContentRaw(call);
  return { label, detail: singleLine(detail) };
};

// RenderToolCall's trailing `{kind: string} & Record<string, unknown>` member
// keeps every case's payload fields `unknown` — read them via these helpers.
const str = (call: RenderToolCall, key: string): string => {
  const v = (call as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};
const items = (call: RenderToolCall): { text: string; done: boolean }[] => {
  const v = (call as Record<string, unknown>).items;
  return Array.isArray(v) ? (v as { text: string; done: boolean }[]) : [];
};

const toolChipContentRaw = (call: RenderToolCall): [string, string] => {
  switch (call.kind) {
    case 'exec':
      return ['Run', str(call, 'command')];
    case 'readFile':
      return ['Read', str(call, 'path')];
    case 'writeFile':
      return ['Write', str(call, 'path')];
    case 'editFile':
      return ['Edit', str(call, 'path')];
    case 'applyPatch':
      return ['Patch', str(call, 'path') || 'workspace'];
    case 'search':
      return [
        'Search',
        str(call, 'path') !== ''
          ? `${str(call, 'pattern')} in ${str(call, 'path')}`
          : str(call, 'pattern'),
      ];
    case 'glob':
      return ['Glob', str(call, 'pattern')];
    case 'webFetch':
      return ['Fetch', str(call, 'url')];
    case 'webSearch':
      return ['Web', str(call, 'query')];
    case 'todo': {
      const list = items(call);
      const done = list.filter(i => i.done).length;
      return ['Todo', `${done}/${list.length} done`];
    }
    case 'mcp':
      return ['MCP', `${str(call, 'server')} · ${str(call, 'tool')}`];
    default: {
      // Subagent spawns decode as unknown named "Agent[: <description>]":
      // label them "Agent" with the description as detail.
      const name = str(call, 'name');
      if (name.startsWith('Agent: '))
        return ['Agent', name.slice('Agent: '.length)];
      if (name === 'Agent') return ['Agent', ''];
      return ['Tool', name];
    }
  }
};

/** Icon per call kind (SF Symbol). */
export const toolIcon = (call: RenderToolCall): SFSymbol => {
  switch (call.kind) {
    case 'exec':
      return 'terminal';
    case 'readFile':
      return 'doc';
    case 'writeFile':
    case 'editFile':
    case 'applyPatch':
      return 'pencil';
    case 'search':
    case 'glob':
      return 'magnifyingglass';
    case 'webFetch':
    case 'webSearch':
      return 'globe';
    case 'todo':
      return 'checklist';
    case 'mcp':
      return 'puzzlepiece.extension';
    default:
      return 'wrench';
  }
};

interface ToolLike {
  call: RenderToolCall;
  isError?: boolean;
}

/** The ToolGroup summary line — "Ran 3 commands · edited 2 files". */
export const toolGroupSummary = (tools: ToolLike[]): string => {
  let commands = 0;
  const edited = new Set<string>();
  let reads = 0;
  let searches = 0;
  let fetches = 0;
  let todos = 0;
  let other = 0;
  let failed = 0;
  for (const t of tools) {
    if (t.isError === true) failed += 1;
    const call = t.call;
    switch (call.kind) {
      case 'exec':
        commands += 1;
        break;
      case 'writeFile':
      case 'editFile':
        edited.add(str(call, 'path'));
        break;
      case 'applyPatch':
        edited.add(str(call, 'path') || 'patch');
        break;
      case 'readFile':
        reads += 1;
        break;
      case 'search':
      case 'glob':
      case 'webSearch':
        searches += 1;
        break;
      case 'webFetch':
        fetches += 1;
        break;
      case 'todo':
        todos += 1;
        break;
      default:
        other += 1;
    }
  }
  const segments: string[] = [];
  if (commands > 0)
    segments.push(`ran ${plural(commands, 'command', 'commands')}`);
  if (edited.size > 0)
    segments.push(`edited ${plural(edited.size, 'file', 'files')}`);
  if (reads > 0) segments.push(`read ${plural(reads, 'file', 'files')}`);
  if (searches > 0)
    segments.push(`searched ${plural(searches, 'time', 'times')}`);
  if (fetches > 0) segments.push(`fetched ${plural(fetches, 'page', 'pages')}`);
  if (todos > 0) segments.push('updated todos');
  if (other > 0) segments.push(`called ${plural(other, 'tool', 'tools')}`);
  if (segments.length === 0)
    segments.push(plural(tools.length, 'tool', 'tools'));
  if (failed > 0) segments.push(`${failed} failed`);
  const summary = segments.join(' · ');
  return summary.charAt(0).toUpperCase() + summary.slice(1);
};
