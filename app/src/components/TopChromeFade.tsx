// Top chrome wash: blur + theme-color fade sitting under floating header
// buttons, dissolving list/transcript content as it scrolls up. Mirrors
// desktop EdgeFade below the titlebar. Reduce Transparency drops the blur
// (FadeBlur returns null) and keeps the color gradient.

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FadeBlur } from './FadeBlur';
import { useTheme } from '../theme';

export const TOP_CHROME_FADE_BAND = 56;

export const hexToRgba = (hex: string, alpha: number): string => {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map(c => c + c)
          .join('')
      : raw;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export function TopChromeFade({
  inset,
  style,
}: {
  /** Opaque plateau covering the header band (safe area + buttons). */
  inset: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const height = Math.max(inset, 0) + TOP_CHROME_FADE_BAND;
  const fadeHold = height <= 0 ? 0.12 : Math.max(inset, 0) / height;
  const opaque = theme.background;
  const mid = hexToRgba(theme.background, 0.55);
  const clear = hexToRgba(theme.background, 0);
  const midAt = Math.min(1, fadeHold + 0.22);
  return (
    <View
      pointerEvents="none"
      testID="top-chrome-fade"
      style={[styles.wrap, { height }, style]}
    >
      <FadeBlur
        fade="down"
        fadeHold={fadeHold}
        intensity={22}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[opaque, opaque, mid, clear]}
        locations={[0, fadeHold, midAt, 1]}
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
  },
});
