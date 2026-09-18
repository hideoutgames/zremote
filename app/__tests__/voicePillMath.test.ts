import {
  formatVoiceElapsed,
  shouldCancelVoice,
  simulatedVoiceLevels,
  VOICE_PILL_BAR_COUNT,
  VOICE_PILL_CANCEL_DISTANCE,
} from '../src/components/voicePillMath';

test('formatVoiceElapsed is m:ss', () => {
  expect(formatVoiceElapsed(0)).toBe('0:00');
  expect(formatVoiceElapsed(1500)).toBe('0:01');
  expect(formatVoiceElapsed(61_000)).toBe('1:01');
});

test('shouldCancelVoice only trips past the left threshold', () => {
  expect(shouldCancelVoice(0)).toBe(false);
  expect(shouldCancelVoice(-VOICE_PILL_CANCEL_DISTANCE)).toBe(true);
  expect(shouldCancelVoice(-20)).toBe(false);
  expect(shouldCancelVoice(40)).toBe(false);
});

test('simulatedVoiceLevels stays in range', () => {
  const levels = simulatedVoiceLevels(1_200, VOICE_PILL_BAR_COUNT, 3);
  expect(levels).toHaveLength(VOICE_PILL_BAR_COUNT);
  expect(levels.every(v => v >= 0 && v <= 1)).toBe(true);
  expect(simulatedVoiceLevels(0, 0)).toEqual([]);
});
