import {
  SWIPE_DISMISS_DISTANCE,
  SWIPE_DISMISS_FLICK,
  isDismissTap,
  isVerticalDownMove,
  shouldDismissKeyboard,
  shouldDismissKeyboardOnSwipe,
} from '../src/navigation/keyboardDismissGesture';

test('isDismissTap accepts a near-stationary release', () => {
  expect(isDismissTap(0, 0)).toBe(true);
  expect(isDismissTap(4, -3)).toBe(true);
  expect(isDismissTap(8, 0)).toBe(false);
  expect(isDismissTap(0, 20)).toBe(false);
});

test('isVerticalDownMove requires a downward pan that dominates dx', () => {
  expect(isVerticalDownMove(0, 20)).toBe(true);
  expect(isVerticalDownMove(4, 20)).toBe(true);
  expect(isVerticalDownMove(20, 4)).toBe(false);
  expect(isVerticalDownMove(0, -20)).toBe(false);
  expect(isVerticalDownMove(-12, 10)).toBe(false);
});

test('shouldDismissKeyboardOnSwipe uses distance or a flick', () => {
  expect(shouldDismissKeyboardOnSwipe(0, SWIPE_DISMISS_DISTANCE, 0)).toBe(true);
  expect(shouldDismissKeyboardOnSwipe(0, 16, 0)).toBe(false);
  expect(shouldDismissKeyboardOnSwipe(0, 14, SWIPE_DISMISS_FLICK)).toBe(true);
  expect(shouldDismissKeyboardOnSwipe(0, 8, SWIPE_DISMISS_FLICK)).toBe(false);
  expect(shouldDismissKeyboardOnSwipe(40, 10, 2)).toBe(false);
});

test('shouldDismissKeyboard is true for a tap or a qualifying swipe', () => {
  expect(shouldDismissKeyboard(0, 0, 0)).toBe(true);
  expect(shouldDismissKeyboard(0, SWIPE_DISMISS_DISTANCE, 0)).toBe(true);
  expect(shouldDismissKeyboard(30, 8, 0)).toBe(false);
});
