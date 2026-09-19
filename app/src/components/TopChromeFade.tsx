// Top chrome dissolve: masked blur sitting under floating header buttons
// so list/transcript content fades as it scrolls up. No light/dark color
// wash — Reduce Transparency drops the blur and leaves the band empty.

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { FadeBlur } from './FadeBlur';

export const TOP_CHROME_FADE_BAND = 56;
/** Strong blur under the header so wallpaper remains, without a color wash. */
export const TOP_CHROME_BLUR_INTENSITY = 90;

export function TopChromeFade({
  inset,
  style,
}: {
  /** Opaque plateau covering the header band (safe area + buttons). */
  inset: number;
  style?: StyleProp<ViewStyle>;
}) {
  const height = Math.max(inset, 0) + TOP_CHROME_FADE_BAND;
  const fadeHold = height <= 0 ? 0.12 : Math.max(inset, 0) / height;
  return (
    <View
      pointerEvents="none"
      testID="top-chrome-fade"
      style={[styles.wrap, { height }, style]}
    >
      <FadeBlur
        fade="down"
        fadeHold={fadeHold}
        intensity={TOP_CHROME_BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
});
