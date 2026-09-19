// Masked BlurView that fades to transparency at the top. Used behind the
// composer and the effort slider so frost is a subtle wash, not a slab.
// Skia is intentionally avoided here (Release worklet crashes).

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
}: {
  intensity: number;
  style?: StyleProp<ViewStyle>;
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
  return (
    <MaskedView
      pointerEvents="none"
      style={style}
      maskElement={
        <LinearGradient
          colors={['transparent', 'black']}
          locations={[0, 1]}
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
