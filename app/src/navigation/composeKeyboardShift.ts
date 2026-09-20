// Collision-only lift for the centered new-thread composer. Re-centering
// inside a KeyboardAvoidingView padding inset always moves the composer
// up by ~half the keyboard even when the resting center already clears it.
// Session composers keep a constant home-indicator pad and interpolate that
// inset via KeyboardStickyView instead (see composerKeyboardStickyOffset).
//
// UI-thread callers must use composeKeyboardShiftPx (primitive args). The
// object helper is JS-only — worklets 0.10.x Release aborts when a style
// worklet calls a cross-file helper with object destructuring / defaults.

export const COMPOSE_KEYBOARD_GAP = 8;

/** Primitive-arg worklet for ComposeKeyboardShift. Gap is required so the
 *  UI runtime never evaluates a default that closes over a module const. */
export const composeKeyboardShiftPx = (
  windowHeight: number,
  composerHeight: number,
  keyboardHeight: number,
  gap: number,
): number => {
  'worklet';
  if (windowHeight <= 0 || composerHeight <= 0 || keyboardHeight <= 0) {
    return 0;
  }
  const composerBottom = (windowHeight + composerHeight) / 2;
  const keyboardTop = windowHeight - keyboardHeight;
  const overlap = Math.max(0, composerBottom + gap - keyboardTop);
  return overlap === 0 ? 0 : -overlap;
};

export const composeKeyboardShift = ({
  windowHeight,
  composerHeight,
  keyboardHeight,
  gap = COMPOSE_KEYBOARD_GAP,
}: {
  windowHeight: number;
  composerHeight: number;
  keyboardHeight: number;
  gap?: number;
}): number =>
  composeKeyboardShiftPx(windowHeight, composerHeight, keyboardHeight, gap);

/** KeyboardStickyView offset so the home-indicator pad interpolates with the
 *  keyboard. `opened` eats `insets.bottom` while the keys are up; `closed`
 *  is 0 because Composer already lays out that pad. height is negative. */
export const composerKeyboardStickyOffset = (
  insetsBottom: number,
): { closed: number; opened: number } => ({
  closed: 0,
  opened: insetsBottom,
});
