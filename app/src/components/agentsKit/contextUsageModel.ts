// Pure helpers for the AI Elements context-usage meter (Apache-2.0,
// components/ai-elements/context.tsx). Host-authored tokens/window only —
// never invent values. Visibility matches desktop has_window: a reported
// window > 0 is enough; tokens may still be waiting.

import type { ContextUsage } from '../../zeron/protocol/types';

export const CONTEXT_DANGER_RATIO = 0.9;
export const CONTEXT_WARN_RATIO = 0.75;

export interface ResolvedContextUsage {
  tokens: number | null;
  window: number;
}

export type ContextUsageTone = 'muted' | 'warn' | 'danger';

export const resolveContextUsage = (
  usage: ContextUsage | undefined,
): ResolvedContextUsage | undefined => {
  if (usage === undefined || usage.window == null || usage.window <= 0)
    return undefined;
  return {
    tokens: usage.tokens == null ? null : usage.tokens,
    window: usage.window,
  };
};

export const contextUsageRatio = (tokens: number, windowSize: number): number =>
  windowSize <= 0 ? 0 : Math.max(0, Math.min(1, tokens / windowSize));

export const contextUsageTone = (
  tokens: number | null,
  windowSize: number,
): ContextUsageTone => {
  if (tokens == null) return 'muted';
  const ratio = contextUsageRatio(tokens, windowSize);
  if (ratio >= CONTEXT_DANGER_RATIO) return 'danger';
  if (ratio >= CONTEXT_WARN_RATIO) return 'warn';
  return 'muted';
};

export const formatCompactTokens = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

export const formatContextPercent = (ratio: number): string =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(ratio);

export const contextRemaining = (tokens: number, windowSize: number): number =>
  Math.max(0, windowSize - tokens);
