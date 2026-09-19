// Swipe-down / tap to unfocus the software keyboard. PanResponder `vy` is
// px per millisecond (same unit as edgeBackGesture).

import { useRef } from 'react';
import { PanResponder } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

export const SWIPE_DISMISS_DISTANCE = 24;
export const SWIPE_DISMISS_FLICK = 0.4;
const SWIPE_DISMISS_SLOPE = 1.2;
const SWIPE_DISMISS_FLICK_MIN_DY = 12;
const TAP_SLOP = 8;

export const isDismissTap = (dx: number, dy: number): boolean =>
  Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP;

export const isVerticalDownMove = (dx: number, dy: number): boolean =>
  dy > 0 && dy >= Math.abs(dx) * SWIPE_DISMISS_SLOPE;

export const shouldDismissKeyboardOnSwipe = (
  dx: number,
  dy: number,
  velocityY: number,
): boolean =>
  isVerticalDownMove(dx, dy) &&
  (dy >= SWIPE_DISMISS_DISTANCE ||
    (dy >= SWIPE_DISMISS_FLICK_MIN_DY && velocityY >= SWIPE_DISMISS_FLICK));

export const shouldDismissKeyboard = (
  dx: number,
  dy: number,
  velocityY: number,
): boolean =>
  isDismissTap(dx, dy) || shouldDismissKeyboardOnSwipe(dx, dy, velocityY);

/** Capture tap and downward pan; dismiss on a qualifying release. */
export function useKeyboardDismissPan() {
  return useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_e, g) => {
        if (shouldDismissKeyboard(g.dx, g.dy, g.vy)) {
          KeyboardController.dismiss();
        }
      },
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;
}
