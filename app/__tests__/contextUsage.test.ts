import { compactTokens } from '../src/components/agentsKit/ContextUsageBar';

test('compactTokens abbreviates thousands and millions', () => {
  expect(compactTokens(800)).toBe('800');
  expect(compactTokens(1200)).toBe('1.2k');
  expect(compactTokens(21_400)).toBe('21k');
  expect(compactTokens(1_000_000)).toBe('1M');
});
