// Plan mode is a client-side composer flag. Turning it on prefixes the
// outgoing prompt so every harness (Cursor, Claude, Codex, Devin) is asked
// to plan before implementing. There is no Plan RPC at this Zeron pin.
// Implement Plan from the plan sheet uses a parallel /build prefix so the
// transcript can show a Build chip without extra message metadata.

export type PromptBadgeKind = 'plan' | 'build';

export const PLAN_PREFIX = '/plan PLEASE CREATE A PLAN BEFORE IMPLEMENTING:';
export const BUILD_PREFIX = '/build IMPLEMENT THE PLAN:';
export const IMPLEMENT_PLAN_TEXT = 'Implement the plan.';

const PLAN_PREFIX_RE =
  /^\/plan\s+PLEASE CREATE A PLAN BEFORE IMPLEMENTING:\s*/i;
const BUILD_PREFIX_RE = /^\/build\s+IMPLEMENT THE PLAN:\s*/i;

const applyPrefix = (prefix: string, re: RegExp, text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  if (re.test(trimmed)) return trimmed;
  return `${prefix} ${trimmed}`;
};

export const applyPlanPrefix = (text: string): string =>
  applyPrefix(PLAN_PREFIX, PLAN_PREFIX_RE, text);

export const applyBuildPrefix = (text: string): string =>
  applyPrefix(BUILD_PREFIX, BUILD_PREFIX_RE, text);

export const stripPlanPrefix = (
  text: string,
): { kind: PromptBadgeKind | null; text: string } => {
  const build = BUILD_PREFIX_RE.exec(text);
  if (build !== null) {
    return { kind: 'build', text: text.slice(build[0].length) };
  }
  const plan = PLAN_PREFIX_RE.exec(text);
  if (plan !== null) {
    return { kind: 'plan', text: text.slice(plan[0].length) };
  }
  return { kind: null, text };
};

export const withPlanPrefixIf = (enabled: boolean, text: string): string =>
  enabled ? applyPlanPrefix(text) : text;

export const withBuildPrefixIf = (enabled: boolean, text: string): string =>
  enabled ? applyBuildPrefix(text) : text;
