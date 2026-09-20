import {
  CONTEXT_DANGER_RATIO,
  CONTEXT_WARN_RATIO,
  contextRemaining,
  contextUsageRatio,
  contextUsageTone,
  formatCompactTokens,
  formatContextPercent,
  resolveContextUsage,
} from '../src/components/agentsKit/contextUsage';

test('resolveContextUsage needs a window greater than zero', () => {
  expect(resolveContextUsage(undefined)).toBeUndefined();
  expect(resolveContextUsage({})).toBeUndefined();
  expect(resolveContextUsage({ tokens: 12 })).toBeUndefined();
  expect(resolveContextUsage({ window: 0 })).toBeUndefined();
  expect(resolveContextUsage({ tokens: 12, window: 0 })).toBeUndefined();
  expect(resolveContextUsage({ tokens: 12, window: 100 })).toEqual({
    tokens: 12,
    window: 100,
  });
});

test('window-only usage is visible while tokens-only is not', () => {
  expect(resolveContextUsage({ window: 100 })).toEqual({
    tokens: null,
    window: 100,
  });
  expect(resolveContextUsage({ tokens: null, window: 100 })).toEqual({
    tokens: null,
    window: 100,
  });
  expect(resolveContextUsage({ tokens: 12, window: null })).toBeUndefined();
});

test('ratio is clamped and treats a zero window as empty', () => {
  expect(contextUsageRatio(0, 100)).toBe(0);
  expect(contextUsageRatio(50, 100)).toBe(0.5);
  expect(contextUsageRatio(150, 100)).toBe(1);
  expect(contextUsageRatio(10, 0)).toBe(0);
  expect(CONTEXT_DANGER_RATIO).toBe(0.9);
  expect(CONTEXT_WARN_RATIO).toBe(0.75);
});

test('tone is muted until 75%, warn until 90%, then danger', () => {
  expect(contextUsageTone(null, 100)).toBe('muted');
  expect(contextUsageTone(74, 100)).toBe('muted');
  expect(contextUsageTone(75, 100)).toBe('warn');
  expect(contextUsageTone(89, 100)).toBe('warn');
  expect(contextUsageTone(90, 100)).toBe('danger');
});

test('formats compact tokens, percent, and remaining', () => {
  expect(formatCompactTokens(842)).toBe('842');
  expect(formatCompactTokens(32_000)).toMatch(/^32\s?K$/i);
  expect(formatContextPercent(0.16)).toBe('16%');
  expect(formatContextPercent(0.125)).toBe('12.5%');
  expect(contextRemaining(32_000, 200_000)).toBe(168_000);
  expect(contextRemaining(250, 100)).toBe(0);
});
