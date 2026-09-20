// Unify how harnesses surface a named plan document in the transcript.
//
// Cursor SDK: unknown tool `createPlan` / `CreatePlan` with
//   { name, overview, plan } on the call, `input`, `arguments`, or `args`.
//   Stock Zeron 0.2.72 sanitizes Unknown.input, so the live doc is often
//   name-only — we still emit a PlanArtifact so the turn is not blank.
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

const asMarkdown = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v !== null && typeof v === 'object') {
    try {
      const json = JSON.stringify(v, null, 2);
      return json === undefined || json === 'null' ? '' : json;
    } catch {
      return '';
    }
  }
  return '';
};

const toolName = (call: Record<string, unknown>): string => {
  if (str(call.kind) === 'mcp')
    return str(call.tool).trim() || str(call.name).trim();
  return str(call.name).trim() || str(call.tool).trim();
};

const isPlanToolName = (name: string): boolean =>
  PLAN_TOOL_NAMES.has(name.toLowerCase());

const fieldBags = (
  call: Record<string, unknown>,
): Record<string, unknown>[] => {
  const bags: Record<string, unknown>[] = [];
  for (const key of ['input', 'arguments', 'args'] as const) {
    const bag = asRecord(call[key]);
    if (bag !== undefined) bags.push(bag);
  }
  bags.push(call);
  return bags;
};

const markdownFromBags = (bags: Record<string, unknown>[]): string => {
  for (const bag of bags) {
    for (const key of ['plan', 'overview', 'content'] as const) {
      const text = asMarkdown(bag[key]);
      if (text.trim() !== '') return text;
    }
  }
  return '';
};

const nameFromBags = (
  bags: Record<string, unknown>[],
  markdown: string,
): string => {
  for (const bag of bags) {
    for (const key of ['name', 'title'] as const) {
      const n = str(bag[key]).trim();
      if (n !== '' && !isPlanToolName(n)) return n;
    }
  }
  return firstHeading(markdown) ?? 'Plan';
};

const planFromCall = (
  call: Record<string, unknown>,
  toolId: string | undefined,
  allowEmpty: boolean,
): PlanArtifact | undefined => {
  const bags = fieldBags(call);
  const markdown = markdownFromBags(bags);
  if (markdown.trim() === '' && !allowEmpty) return undefined;
  return { name: nameFromBags(bags, markdown), markdown, toolId };
};

const firstHeading = (markdown: string): string | undefined => {
  const line = markdown.trimStart().split('\n', 1)[0]?.trim() ?? '';
  const heading = /^#+\s+(.+)$/.exec(line);
  return heading ? heading[1].trim() : undefined;
};

const isEnterPlanMode = (name: string): boolean =>
  /enterplanmode/i.test(name) || /^switchmode$/i.test(name);

const isCreatePlanPart = (
  call: Record<string, unknown>,
  partId: string,
): boolean =>
  isPlanToolName(toolName(call)) ||
  partId === 'acp-plan' ||
  partId === 'cursor-plan';

/** Pick the best plan document on an assistant entry, if any. */
export const detectPlanArtifact = (
  entry: MessageEntry,
): PlanArtifact | undefined => {
  let createPlan: PlanArtifact | undefined;
  let enterPlan = false;
  let firstText: string | undefined;
  for (const part of entry.parts) {
    if (part.kind === 'text' && firstText === undefined && part.text.trim())
      firstText = part.text;
    if (part.kind !== 'tool') continue;
    const call = rec(part.call);
    const name = toolName(call);
    if (isCreatePlanPart(call, part.id)) {
      const found = planFromCall(call, part.id, isPlanToolName(name));
      if (found !== undefined) {
        if (found.markdown.trim() !== '') return found;
        if (createPlan === undefined && isPlanToolName(name))
          createPlan = found;
      }
    }
    if (isEnterPlanMode(name)) enterPlan = true;
  }
  if (createPlan !== undefined) {
    if (firstText !== undefined && createPlan.markdown.trim() === '') {
      return {
        name:
          createPlan.name !== 'Plan'
            ? createPlan.name
            : firstHeading(firstText) ?? 'Plan',
        markdown: firstText,
        toolId: createPlan.toolId,
      };
    }
    return createPlan;
  }
  if (enterPlan && firstText !== undefined)
    return {
      name: firstHeading(firstText) ?? 'Plan',
      markdown: firstText,
    };
  return undefined;
};

/** True when this tool part is shown as a PlanCard (or is ExitPlanMode) —
 * hide the raw unknown-tool chip. CreatePlan-class parts always hide
 * because `detectPlanArtifact` always emits a card for them. */
export const isPlanToolPart = (part: MessagePart): boolean => {
  if (part.kind !== 'tool') return false;
  const call = rec(part.call);
  const name = toolName(call);
  if (isPlanToolName(name) || isEnterPlanMode(name)) return true;
  if (/exitplanmode/i.test(name)) return true;
  if (part.id === 'acp-plan' || part.id === 'cursor-plan')
    return planFromCall(call, part.id, false) !== undefined;
  return false;
};
