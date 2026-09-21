// Plan mode is a client-side composer flag. Turning it on prefixes the
// outgoing prompt so every harness (Cursor, Claude, Codex, Devin) is asked
// to plan before implementing. There is no Plan RPC at this Zeron pin.
// The prefix must not start with `/plan` — that slash token trips provider
// plan modes (Cursor CreatePlan, Claude EnterPlanMode). Instructions also
// tell the model not to call those tools; the plan is caught from marked
// markdown in the reply.
// Implement Plan from the plan sheet uses a parallel /build prefix so the
// transcript can show a Build chip without extra message metadata.

export type PromptBadgeKind = 'plan' | 'build';

export const PLAN_START_MARKER = 'ZERON_PLAN_START';
export const PLAN_END_MARKER = 'ZERON_PLAN_END';

export const PLAN_PREFIX = `PLEASE CREATE A PLAN BEFORE IMPLEMENTING. Do not write or edit files yet. Do not use a plan tool, CreatePlan, EnterPlanMode, SwitchMode, or any other provider plan mode.

When the plan is ready, output the FULL markdown plan between these exact lines (include a # title), then stop and wait. Write the plan as markdown text only.

${PLAN_START_MARKER}
# Title
(the full plan)
${PLAN_END_MARKER}

Request:`;

export const BUILD_PREFIX = '/build IMPLEMENT THE PLAN:';
export const IMPLEMENT_PLAN_TEXT = 'Implement the plan.';

const PLAN_PREFIX_RE =
  /^PLEASE CREATE A PLAN BEFORE IMPLEMENTING[\s\S]*?\nRequest:\s*/i;
const LEGACY_PLAN_PREFIX_RE =
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
  const legacy = LEGACY_PLAN_PREFIX_RE.exec(text);
  if (legacy !== null) {
    return { kind: 'plan', text: text.slice(legacy[0].length) };
  }
  return { kind: null, text };
};

export const withPlanPrefixIf = (enabled: boolean, text: string): string =>
  enabled ? applyPlanPrefix(text) : text;

export const withBuildPrefixIf = (enabled: boolean, text: string): string =>
  enabled ? applyBuildPrefix(text) : text;
