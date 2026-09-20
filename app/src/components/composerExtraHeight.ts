// Grabber extra-height caps and the 1:1 transcript inset.
// Layout must grow by exactly extraHeight (not iOS TextInput minHeight).
// Transcript inset, fade, and rail follow the measured composer box
// (onLayout), not the live extra-height store write.

import { makeMutable, type SharedValue } from 'react-native-reanimated';

/** Hard cap after the 10% shrink from 280. */
export const COMPOSER_EXTRA_MAX = 252;
/** Window-height fraction after the 10% shrink from 0.4. */
export const COMPOSER_EXTRA_WINDOW_FRAC = 0.36;

export const composerExtraMax = (windowHeight: number): number =>
  Math.min(
    COMPOSER_EXTRA_MAX,
    Math.round(windowHeight * COMPOSER_EXTRA_WINDOW_FRAC),
  );

export const clampComposerExtraHeight = (extra: number, max: number): number =>
  Math.max(0, Math.min(max, Math.round(extra)));

/** Sticky-stack inset: measured base (no extra) plus live extraHeight. */
export const composerListInset = (
  baseHeight: number,
  extraHeight: number,
): number => baseHeight + extraHeight;

/**
 * First-paint fallback so FlashList is not pinned to the physical bottom
 * under the overlay composer. grabber 21 + input 60 + lower row ~54 + pad.
 */
export const COMPOSER_INSET_FALLBACK = 148;

const mutableNumber = (initial: number): SharedValue<number> => {
  if (typeof makeMutable === 'function') {
    const created = makeMutable(initial);
    if (created != null && typeof created === 'object' && 'value' in created) {
      return created;
    }
  }
  return { value: initial } as SharedValue<number>;
};

/** Live extra height the grabber writes on pan frames (no React commit). */
export const composerExtraHeightSV = mutableNumber(0);
/** Measured sticky-stack height with extraHeight stripped out. */
export const composerBaseHeightSV = mutableNumber(0);
/** Measured sticky-stack height (onLayout). Source of truth for list/fade. */
export const composerInsetSV = mutableNumber(0);

export const syncComposerExtraHeightSV = (v: number): void => {
  composerExtraHeightSV.value = v;
};

let lastMeasuredComposerInset = 0;

export const rememberComposerInset = (height: number): void => {
  if (height > 0) lastMeasuredComposerInset = height;
};

export const seedComposerInset = (): number => {
  const v =
    lastMeasuredComposerInset > 0
      ? lastMeasuredComposerInset
      : COMPOSER_INSET_FALLBACK;
  composerInsetSV.value = v;
  return v;
};

export const resetComposerInsetSeed = (): void => {
  lastMeasuredComposerInset = 0;
  composerInsetSV.value = 0;
  composerBaseHeightSV.value = 0;
};

let composerResizeActive = false;
const resizeEndListeners = new Set<() => void>();

export const isComposerResizeActive = (): boolean => composerResizeActive;

export const beginComposerResize = (): void => {
  composerResizeActive = true;
};

export const endComposerResize = (): void => {
  if (!composerResizeActive) return;
  composerResizeActive = false;
  resizeEndListeners.forEach(fn => fn());
};

export const onComposerResizeEnd = (fn: () => void): (() => void) => {
  resizeEndListeners.add(fn);
  return () => {
    resizeEndListeners.delete(fn);
  };
};
