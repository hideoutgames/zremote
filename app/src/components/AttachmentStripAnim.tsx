// Tiny worklet-only child. React Compiler + worklets 0.10.x serializes the
// parent memo cache; keep this file free of runtime/Sets/functions so a
// leftover capture cannot RCTFatal in Release/TestFlight.

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

export function AttachmentStripAnim({
  height,
  opacity,
  duration,
  pointerEvents,
  style,
  children,
}: {
  height: number;
  opacity: number;
  duration: number;
  pointerEvents: 'auto' | 'none';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  'use no memo';
  const anim = useAnimatedStyle(() => ({
    // Height tracks layout immediately so the chat inset stays in lockstep
    // with the strip (timed height desynced the transcript). Opacity still
    // eases.
    height,
    opacity: withTiming(opacity, { duration }),
  }));
  return (
    <Animated.View style={[style, anim]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  );
}
