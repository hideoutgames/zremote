// Unify how harnesses surface a named plan document in the transcript.
//
// Cursor SDK: unknown tool `createPlan` / `CreatePlan` with
//   { name, overview, plan } on the call or `input`.
// Cursor ACP (historical): todo chip id `cursor-plan`.
// Claude Code: `EnterPlanMode` unknown tool; the following text part is the
//   plan markdown (ExitPlanMode / SwitchMode are ignored here).
// Codex: `todoList` already renders as TaskRows; structured plan deltas are
//   dropped by the host — no document to show.
// Devin / ACP: live tool id `acp-plan` (todos). We still prefer a markdown
//   `plan` field when the host preserved it on the call.

import type { MessageEntry, MessagePart } from '../../zeron/protocol/types';

export interface PlanArtifact {
  name: string;
  markdown: string;
  toolId?: string;
}

const PLAN_TOOL_NAMES = new Set([
  'createplan',
  'create_plan',
  'cursor/create_plan',
]);

const rec = (call: object): Record<string, unknown> =>
  call as Record<string, unknown>;

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const toolName = (call: Record<string, unknown>): string =>
  str(call.name).trim();

const isPlanToolName = (name: string): boolean =>
  PLAN_TOOL_NAMES.has(name.toLowerCase());

const planFromCall = (
  call: Record<string, unknown>,
  toolId?: string,
): PlanArtifact | undefined => {
  const input = asRecord(call.input) ?? call;
  const markdown = str(input.plan) || str(input.overview) || str(input.content);
  if (markdown.trim() === '') return undefined;
  const name =
    str(input.name).trim() ||
    str(input.title).trim() ||
    firstHeading(markdown) ||
    'Plan';
  return { name, markdown, toolId };
};

const firstHeading = (markdown: string): string | undefined => {
  const line = markdown.trimStart().split('\n', 1)[0]?.trim() ?? '';
  const heading = /^#+\s+(.+)$/.exec(line);
  return heading ? heading[1].trim() : undefined;
};

const isEnterPlanMode = (name: string): boolean =>
  /enterplanmode/i.test(name) || /^switchmode$/i.test(name);

/** Pick the best plan document on an assistant entry, if any. */
export const detectPlanArtifact = (
  entry: MessageEntry,
): PlanArtifact | undefined => {
  let enterPlan = false;
  let firstText: string | undefined;
  for (const part of entry.parts) {
    if (part.kind === 'text' && firstText === undefined && part.text.trim())
      firstText = part.text;
    if (part.kind !== 'tool') continue;
    const call = rec(part.call);
    const name = toolName(call);
    if (
      isPlanToolName(name) ||
      part.id === 'acp-plan' ||
      part.id === 'cursor-plan'
    ) {
      const found = planFromCall(call, part.id);
      if (found !== undefined) return found;
    }
    if (isEnterPlanMode(name)) enterPlan = true;
  }
  if (enterPlan && firstText !== undefined)
    return {
      name: firstHeading(firstText) ?? 'Plan',
      markdown: firstText,
    };
  return undefined;
};

/** True when this tool part is the CreatePlan-class call we already show
 * as a PlanCard — hide the raw unknown-tool chip. */
export const isPlanToolPart = (part: MessagePart): boolean => {
  if (part.kind !== 'tool') return false;
  const call = rec(part.call);
  const name = toolName(call);
  if (isPlanToolName(name) || isEnterPlanMode(name)) return true;
  if (/exitplanmode/i.test(name)) return true;
  if (part.id === 'acp-plan' || part.id === 'cursor-plan')
    return planFromCall(call, part.id) !== undefined;
  return false;
};
