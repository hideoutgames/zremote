// Masked BlurView that fades to transparency. Used behind the composer
// (fade up) and the centered effort slider (fade both edges). Skia is
// intentionally avoided here (Release worklet crashes).

import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useTheme } from '../theme';

export function FadeBlur({
  intensity,
  style,
  fade = 'up',
}: {
  intensity: number;
  style?: StyleProp<ViewStyle>;
  fade?: 'up' | 'vertical';
}) {
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
  if (reduceTransparency) return null;
  const tint: BlurTint =
    theme.scheme === 'dark'
      ? 'systemThinMaterialDark'
      : 'systemThinMaterialLight';
  const colors =
    fade === 'vertical'
      ? (['transparent', 'black', 'transparent'] as const)
      : (['transparent', 'black'] as const);
  const locations =
    fade === 'vertical' ? ([0, 0.5, 1] as const) : ([0, 1] as const);
  return (
    <MaskedView
      pointerEvents="none"
      style={style}
      maskElement={
        <LinearGradient
          colors={colors}
          locations={locations}
          style={StyleSheet.absoluteFill}
        />
      }
    >
      <BlurView
        tint={tint}
        intensity={intensity}
        style={StyleSheet.absoluteFill}
      />
    </MaskedView>
  );
}
