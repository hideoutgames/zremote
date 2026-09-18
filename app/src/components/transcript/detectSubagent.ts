// Subagent spawn chips from the host CRDT.
//
// Zeron encodes a spawn as an unknown tool named `Agent` / `Agent: <title>`
// with optional `call.input.subagent_type` and `subagentStatus` on the part.
// `subagentStatus` is independent of `resolved` — the spawn tool can resolve
// while the child is still running.

import type {
  MessageEntry,
  MessagePart,
  RenderToolCall,
  SubagentStatus,
} from '../../zeron/protocol/types';

export type ToolPart = Extract<MessagePart, { kind: 'tool' }>;

export type SubagentView = {
  id: string;
  title: string;
  agentName: string;
  state: SubagentStatus;
};

const rec = (call: RenderToolCall): Record<string, unknown> =>
  call as Record<string, unknown>;

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const callName = (call: RenderToolCall): string => str(rec(call).name).trim();

const isAgentName = (name: string): boolean =>
  name === 'Agent' || name.startsWith('Agent: ');

export const isSubagentSpawn = (part: MessagePart): part is ToolPart => {
  if (part.kind !== 'tool') return false;
  if (part.subagentStatus !== undefined || part.subagentRef !== undefined) {
    return true;
  }
  return isAgentName(callName(part.call));
};

const spawnTitle = (call: RenderToolCall): string => {
  const name = callName(call);
  if (name.startsWith('Agent: ')) {
    const title = name.slice('Agent: '.length).trim();
    if (title !== '') return title;
  }
  return 'Subagent';
};

/** Light aliases so host types like `Explore` match Cursor Mobile copy. */
export const humanizeAgentName = (raw: string): string => {
  const key = raw.trim().toLowerCase().replace(/[_-]/g, '');
  if (key === 'explore' || key === 'explorer') return 'Explorer';
  if (key === 'generalpurpose' || key === 'general') return 'General';
  return raw.trim();
};

const spawnAgentName = (call: RenderToolCall): string => {
  const input = asRecord(rec(call).input) ?? rec(call);
  const raw = str(input.subagent_type).trim();
  return raw === '' ? '' : humanizeAgentName(raw);
};

const spawnState = (part: ToolPart): SubagentStatus => {
  if (
    part.subagentStatus === 'running' ||
    part.subagentStatus === 'done' ||
    part.subagentStatus === 'failed'
  ) {
    return part.subagentStatus;
  }
  if (part.isError === true) return 'failed';
  if (!part.resolved) return 'running';
  return 'done';
};

export const subagentView = (part: ToolPart): SubagentView => ({
  id: part.id,
  title: spawnTitle(part.call),
  agentName: spawnAgentName(part.call),
  state: spawnState(part),
});

/** All spawns in the thread, currently-working first, then transcript order. */
export const collectThreadSubagents = (
  entries: MessageEntry[],
): SubagentView[] => {
  const views: SubagentView[] = [];
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (isSubagentSpawn(part)) views.push(subagentView(part));
    }
  }
  const running = views.filter(v => v.state === 'running');
  const rest = views.filter(v => v.state !== 'running');
  return [...running, ...rest];
};
