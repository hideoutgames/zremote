// Tiny worklet child: collision-only lift tracks the keyboard on the UI
// thread. Keep this out of SessionScreen — React Compiler + worklets 0.10.x
// serializes that screen's memo cache and 0.10.1 throws in Release.

import React, { useEffect } from 'react';
import {
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import {
  COMPOSE_KEYBOARD_GAP,
  composeKeyboardShiftPx,
} from '../navigation/composeKeyboardShift';

const ZERO_SHIFT = { transform: [{ translateY: 0 }] } as const;

export function ComposeKeyboardShift({
  composerHeight,
  style,
  pointerEvents,
  testID,
  children,
}: {
  composerHeight: number;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'auto' | 'none' | 'box-none';
  testID?: string;
  children: React.ReactNode;
}) {
  'use no memo';
  const { height: windowHeight } = useWindowDimensions();
  const { height: kbHeight } = useReanimatedKeyboardAnimation();
  const windowHeightSV = useSharedValue(windowHeight);
  const composerHeightSV = useSharedValue(composerHeight);
  useEffect(() => {
    windowHeightSV.value = windowHeight;
  }, [windowHeight, windowHeightSV]);
  useEffect(() => {
    composerHeightSV.value = composerHeight;
  }, [composerHeight, composerHeightSV]);
  const anim = useAnimatedStyle(() => {
    try {
      const keyboardHeight =
        kbHeight == null || typeof kbHeight.value !== 'number'
          ? 0
          : Math.max(0, -kbHeight.value);
      const shift = composeKeyboardShiftPx(
        windowHeightSV.value,
        composerHeightSV.value,
        keyboardHeight,
        COMPOSE_KEYBOARD_GAP,
      );
      return { transform: [{ translateY: shift }] };
    } catch {
      return ZERO_SHIFT;
    }
  });
  return (
    <Animated.View
      testID={testID}
      style={[style, anim]}
      pointerEvents={pointerEvents}
    >
      {children}
    </Animated.View>
  );
}
