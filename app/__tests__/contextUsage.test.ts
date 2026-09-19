import {
  CONTEXT_DANGER_RATIO,
  contextRemaining,
  contextUsageRatio,
  formatCompactTokens,
  formatContextPercent,
  resolveContextUsage,
} from '../src/components/agentsKit/contextUsage';

test('resolveContextUsage requires both tokens and window', () => {
  expect(resolveContextUsage(undefined)).toBeUndefined();
  expect(resolveContextUsage({})).toBeUndefined();
  expect(resolveContextUsage({ tokens: 12 })).toBeUndefined();
  expect(resolveContextUsage({ window: 100 })).toBeUndefined();
  expect(resolveContextUsage({ tokens: null, window: 100 })).toBeUndefined();
  expect(resolveContextUsage({ tokens: 12, window: 100 })).toEqual({
    tokens: 12,
    window: 100,
  });
});

test('ratio is clamped and treats a zero window as empty', () => {
  expect(contextUsageRatio(0, 100)).toBe(0);
  expect(contextUsageRatio(50, 100)).toBe(0.5);
  expect(contextUsageRatio(150, 100)).toBe(1);
  expect(contextUsageRatio(10, 0)).toBe(0);
  expect(CONTEXT_DANGER_RATIO).toBe(0.9);
});

test('formats compact tokens, percent, and remaining', () => {
  expect(formatCompactTokens(842)).toBe('842');
  expect(formatCompactTokens(32_000)).toMatch(/^32\s?K$/i);
  expect(formatContextPercent(0.16)).toBe('16%');
  expect(formatContextPercent(0.125)).toBe('12.5%');
  expect(contextRemaining(32_000, 200_000)).toBe(168_000);
  expect(contextRemaining(250, 100)).toBe(0);
});
