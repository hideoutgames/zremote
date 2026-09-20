// Tiny worklet child: collision-only lift tracks the keyboard on the UI
// thread. Keep this out of SessionScreen — React Compiler + worklets 0.10.x
// serializes that screen's memo cache and 0.10.1 throws in Release.

import React from 'react';
import {
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { composeKeyboardShift } from '../navigation/composeKeyboardShift';

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
  const anim = useAnimatedStyle(() => {
    const keyboardHeight = Math.max(0, -kbHeight.value);
    const shift = composeKeyboardShift({
      windowHeight,
      composerHeight,
      keyboardHeight,
    });
    return { transform: [{ translateY: shift }] };
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
