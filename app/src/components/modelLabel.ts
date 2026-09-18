// Provider mark + short composer label. Catalog `Model.label` is the source
// of truth; we only strip a known provider/harness prefix so the pill can
// show "<logo> Opus 5" instead of "Claude Code Opus 5".

export type ProviderKind =
  | 'claude'
  | 'openai'
  | 'cursor'
  | 'devin'
  | 'grok'
  | 'zhipu'
  | 'google'
  | 'generic';

const PREFIXES: readonly RegExp[] = [
  /^claude code\s+/i,
  /^claude\s+/i,
  /^openai codex\s+/i,
  /^openai\s+/i,
  /^anthropic\s+/i,
  /^devin\s+/i,
  /^google\s+/i,
  /^gemini\s+/i,
];

/** Strip a leading provider/harness name from a catalog label. */
export const shortModelLabel = (
  label: string | undefined,
  fallbackId?: string,
): string => {
  const raw = (label ?? '').trim() || (fallbackId ?? '').trim();
  if (raw === '') return '';
  let next = raw;
  for (const re of PREFIXES) next = next.replace(re, '');
  return next.trim() || raw;
};

export const capitalizeEffort = (level: string): string =>
  level.length === 0 ? level : level[0].toUpperCase() + level.slice(1);

export const composerShowsEffort = (levels: readonly string[]): boolean =>
  levels.length > 0;

/** Map harness + model id to a provider mark. Model id wins for mixed catalogs. */
export const providerKind = (
  harness?: string,
  modelId?: string,
): ProviderKind => {
  const h = (harness ?? '').toLowerCase();
  const m = (modelId ?? '').toLowerCase();
  if (
    h.includes('claude') ||
    m.includes('claude') ||
    m.includes('sonnet') ||
    m.includes('opus') ||
    m.includes('haiku')
  )
    return 'claude';
  if (
    h === 'codex' ||
    h.includes('openai') ||
    m.includes('gpt') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.includes('codex')
  )
    return 'openai';
  if (h.includes('cursor') || m.includes('cursor') || m.includes('composer'))
    return 'cursor';
  if (h.includes('devin') || m.includes('devin')) return 'devin';
  if (h.includes('grok') || m.includes('grok')) return 'grok';
  if (
    m.includes('glm') ||
    m.includes('zhipu') ||
    h.includes('zhipu') ||
    h.includes('zai')
  )
    return 'zhipu';
  if (m.includes('gemini') || h.includes('gemini') || h.includes('antigravity'))
    return 'google';
  return 'generic';
};
