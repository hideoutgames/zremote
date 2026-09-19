// Pure helpers for the AI Elements context-usage meter (Apache-2.0,
// components/ai-elements/context.tsx). Host-authored tokens/window only —
// never invent values.

import type { ContextUsage } from '../../zeron/protocol/types';

export const CONTEXT_DANGER_RATIO = 0.9;

export interface ResolvedContextUsage {
  tokens: number;
  window: number;
}

export const resolveContextUsage = (
  usage: ContextUsage | undefined,
): ResolvedContextUsage | undefined => {
  if (usage === undefined || usage.tokens == null || usage.window == null)
    return undefined;
  return { tokens: usage.tokens, window: usage.window };
};

export const contextUsageRatio = (
  tokens: number,
  windowSize: number,
): number =>
  windowSize <= 0 ? 0 : Math.max(0, Math.min(1, tokens / windowSize));

export const formatCompactTokens = (n: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

export const formatContextPercent = (ratio: number): string =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(ratio);

export const contextRemaining = (tokens: number, windowSize: number): number =>
  Math.max(0, windowSize - tokens);
