// Tiny worklet-only children. Bottom chrome and sticky offsets track the
// grabber extra-height shared value so SessionScreen does not re-render
// every pan frame.

import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import type { BlurTint } from 'expo-blur';
import { ChromeFade, TOP_CHROME_FADE_BAND } from './TopChromeFade';
import {
  composerBaseHeightSV,
  composerExtraHeightSV,
} from './composerExtraHeight';

export function ComposerChromeFade({
  fadeBand = TOP_CHROME_FADE_BAND,
  wash,
  tint,
  inset,
}: {
  fadeBand?: number;
  wash?: string;
  tint?: BlurTint;
  /** Committed inset for fadeHold; live height comes from extra SV. */
  inset: number;
}) {
  'use no memo';
  const heightStyle = useAnimatedStyle(() => ({
    height:
      Math.max(0, composerBaseHeightSV.value + composerExtraHeightSV.value) +
      fadeBand,
  }));
  return (
    <ChromeFade
      edge="bottom"
      inset={inset}
      fadeBand={fadeBand}
      wash={wash}
      tint={tint}
      animatedStyle={heightStyle}
    />
  );
}

export function ComposerStickyBottom({
  extra = 0,
  style,
  pointerEvents,
  children,
}: {
  extra?: number;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'auto' | 'none' | 'box-none';
  children: React.ReactNode;
}) {
  'use no memo';
  const anim = useAnimatedStyle(() => ({
    bottom:
      Math.max(0, composerBaseHeightSV.value + composerExtraHeightSV.value) +
      extra,
  }));
  return (
    <Animated.View style={[style, anim]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  );
}
