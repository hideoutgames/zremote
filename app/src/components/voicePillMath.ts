// Voice-pill geometry and clock (React Bits VoicePill interaction,
// reimplemented for React Native — no web source).

export const VOICE_PILL_SIZE = 32;
export const VOICE_PILL_OPEN_WIDTH = 148;
export const VOICE_PILL_BAR_COUNT = 14;
export const VOICE_PILL_CANCEL_DISTANCE = 64;
export const VOICE_PILL_OPEN_MS = 200;
export const VOICE_PILL_PROCESS_MS = 2000;
/** Gap between the mic slot and the send hit target in Composer's trailing cluster. */
export const VOICE_PILL_TRAILING_GAP = 4;
/** Send Pressable `minWidth` / `minHeight` — the 32px circle is centered inside. */
export const VOICE_PILL_SEND_HIT = 44;
/** Idle center-to-center offset so the mic circle lands on send. */
export const VOICE_PILL_COVER_OFFSET =
  VOICE_PILL_SIZE +
  VOICE_PILL_TRAILING_GAP +
  (VOICE_PILL_SEND_HIT - VOICE_PILL_SIZE) / 2;

/** Reanimated worklet: slide the pill over send while growing left from that slot. */
export const voicePillCoverTranslate = (
  open: number,
  cover: number,
  slide: number,
): number => {
  'worklet';
  return (
    cover * VOICE_PILL_COVER_OFFSET -
    open * (VOICE_PILL_OPEN_WIDTH - VOICE_PILL_SIZE) +
    slide
  );
};

export const formatVoiceElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const shouldCancelVoice = (
  dx: number,
  distance: number = VOICE_PILL_CANCEL_DISTANCE,
): boolean => dx <= -distance;

/** Simulated equalizer heights in [0, 1] from time + optional speech tick. */
export const simulatedVoiceLevels = (
  nowMs: number,
  count: number,
  tick = 0,
): number[] => {
  const n = Math.max(0, count);
  const out: number[] = [];
  const speech = 0.12 * Math.min(1, tick % 7);
  for (let i = 0; i < n; i++) {
    const a = Math.sin(nowMs / 180 + i * 0.7);
    const b = Math.sin(nowMs / 310 + i * 1.3);
    out.push(
      Math.min(1, 0.22 + 0.45 * Math.abs(a) + 0.25 * Math.abs(b) + speech),
    );
  }
  return out;
};
