// Plan mode is a client-side composer flag. Turning it on prefixes the
// outgoing prompt so every harness (Cursor, Claude, Codex, Devin) is asked
// to plan before implementing. There is no Plan RPC at this Zeron pin.

export const PLAN_PREFIX = '/plan PLEASE CREATE A PLAN BEFORE IMPLEMENTING:';

const PREFIX_RE = /^\/plan\s+PLEASE CREATE A PLAN BEFORE IMPLEMENTING:\s*/i;

export const applyPlanPrefix = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  if (PREFIX_RE.test(trimmed)) return trimmed;
  return `${PLAN_PREFIX} ${trimmed}`;
};

export const stripPlanPrefix = (
  text: string,
): { plan: boolean; text: string } => {
  const match = PREFIX_RE.exec(text);
  if (match === null) return { plan: false, text };
  return { plan: true, text: text.slice(match[0].length) };
};

export const withPlanPrefixIf = (enabled: boolean, text: string): string =>
  enabled ? applyPlanPrefix(text) : text;
