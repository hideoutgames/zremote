// Clipped chat bubble: heavy BlurView of whatever sits behind, then a light
// theme wash. Reduce Transparency drops the blur for a near-opaque fill.
// Not Glass — bubbles are content, not chrome (no hairline, no liquid-glass
// clustering).

import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import { useTheme } from '../../theme';

export const BUBBLE_BLUR_INTENSITY = 100;
const FALLBACK_ALPHA = 0.92;

const opaqueWash = (color: ColorValue): ColorValue => {
  if (typeof color !== 'string') return color;
  const match =
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/.exec(color);
  if (!match) return color;
  return `rgba(${match[1]},${match[2]},${match[3]},${FALLBACK_ALPHA})`;
};

type FrostedBubbleProps = ViewProps & {
  tintColor: ColorValue;
  contentStyle?: StyleProp<ViewStyle>;
};

export function FrostedBubble({
  style,
  contentStyle,
  tintColor,
  testID,
  children,
  ...rest
}: FrostedBubbleProps) {
  const theme = useTheme();
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(setReduceTransparency)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => sub.remove();
  }, []);

  const pad = <View style={contentStyle}>{children}</View>;

  if (reduceTransparency) {
    return (
      <View
        testID={testID}
        style={[style, { backgroundColor: opaqueWash(tintColor) }]}
        {...rest}
      >
        {pad}
      </View>
    );
  }

  const tint: BlurTint =
    theme.scheme === 'dark'
      ? 'systemThinMaterialDark'
      : 'systemThinMaterialLight';

  return (
    <View testID={testID} style={[styles.clip, style]} {...rest}>
      <BlurView
        pointerEvents="none"
        tint={tint}
        intensity={BUBBLE_BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]}
      />
      {pad}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
