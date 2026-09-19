import {
  formatVoiceElapsed,
  shouldCancelVoice,
  simulatedVoiceLevels,
  voicePillCoverTranslate,
  VOICE_PILL_BAR_COUNT,
  VOICE_PILL_CANCEL_DISTANCE,
  VOICE_PILL_COVER_OFFSET,
  VOICE_PILL_OPEN_WIDTH,
  VOICE_PILL_SEND_HIT,
  VOICE_PILL_SIZE,
  VOICE_PILL_TRAILING_GAP,
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

test('VOICE_PILL_COVER_OFFSET is the idle circle center-to-center distance', () => {
  expect(VOICE_PILL_COVER_OFFSET).toBe(
    VOICE_PILL_SIZE +
      VOICE_PILL_TRAILING_GAP +
      (VOICE_PILL_SEND_HIT - VOICE_PILL_SIZE) / 2,
  );
  expect(VOICE_PILL_COVER_OFFSET).toBe(42);
});

test('voicePillCoverTranslate at idle / cover-only / open+cover', () => {
  expect(voicePillCoverTranslate(0, 0, 0)).toBe(0);
  expect(voicePillCoverTranslate(0, 1, 0)).toBe(VOICE_PILL_COVER_OFFSET);
  expect(voicePillCoverTranslate(1, 1, 0)).toBe(
    VOICE_PILL_COVER_OFFSET - (VOICE_PILL_OPEN_WIDTH - VOICE_PILL_SIZE),
  );
  expect(voicePillCoverTranslate(1, 1, -20)).toBe(
    VOICE_PILL_COVER_OFFSET - (VOICE_PILL_OPEN_WIDTH - VOICE_PILL_SIZE) - 20,
  );
});
