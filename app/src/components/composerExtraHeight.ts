// Grabber extra-height caps and the 1:1 transcript inset.
// Layout must grow by exactly extraHeight (not iOS TextInput minHeight),
// and the list inset must use that same extraHeight.

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
  Math.max(0, Math.min(max, extra));

/** Sticky-stack inset: measured base (no extra) plus live extraHeight. */
export const composerListInset = (
  baseHeight: number,
  extraHeight: number,
): number => baseHeight + extraHeight;
