import { formatElapsed, simulatedLevel } from '../src/components/VoicePill';

test('formatElapsed is m:ss with a padded second', () => {
  expect(formatElapsed(0)).toBe('0:00');
  expect(formatElapsed(1_000)).toBe('0:01');
  expect(formatElapsed(61_500)).toBe('1:01');
});

test('simulatedLevel stays in 0..1 and peaks on a syllable', () => {
  const idle = simulatedLevel(0);
  const peak = simulatedLevel(0.5 + 0.1);
  expect(idle).toBeGreaterThanOrEqual(0);
  expect(idle).toBeLessThan(0.3);
  expect(peak).toBeGreaterThan(idle);
  expect(peak).toBeLessThanOrEqual(1);
});
