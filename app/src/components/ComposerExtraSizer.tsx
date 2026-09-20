// Tiny worklet-only child. React Compiler + worklets 0.10.x serializes the
// parent memo cache; keep this file free of runtime/Sets/functions so a
// leftover capture cannot RCTFatal in Release/TestFlight.

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { composerExtraHeightSV } from './composerExtraHeight';

export function ComposerExtraSizer({
  minHeight,
  maxHeight,
  style,
  children,
}: {
  minHeight: number;
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  'use no memo';
  const anim = useAnimatedStyle(() => ({
    minHeight: minHeight + composerExtraHeightSV.value,
    maxHeight: maxHeight + composerExtraHeightSV.value,
    overflow: 'hidden' as const,
  }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
