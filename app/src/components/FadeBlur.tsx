// Masked BlurView that fades to transparency. Used behind the composer
// (fade up), the centered effort slider (soft rectangle with faded
// edges on all sides), the session wallpaper (horizontal fade into
// sharp gutters on iPad; unmasked full-bleed on iPhone), and the top
// chrome dissolve. Skia is intentionally avoided here (Release worklet
// crashes).

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

const EDGE_COLORS = ['transparent', 'black', 'black', 'transparent'] as const;
/** Inner plateau is the effort cluster; fade lives in the wash padding. */
const EDGE_LOCATIONS = [0, 0.25, 0.75, 1] as const;

function GradientMask({
  start,
  end,
}: {
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}) {
  return (
    <LinearGradient
      colors={EDGE_COLORS}
      locations={EDGE_LOCATIONS}
      start={start}
      end={end}
      style={StyleSheet.absoluteFill}
    />
  );
}

export function FadeBlur({
  intensity,
  style,
  fade = 'up',
  fadeHold,
  tint: tintOverride,
}: {
  intensity: number;
  style?: StyleProp<ViewStyle>;
  fade?: 'up' | 'down' | 'vertical' | 'radial' | 'horizontal' | 'none';
  /** For `down`, the 0–1 location where the opaque plateau ends.
   *  For `up`, the 0–1 plateau at the bottom.
   *  For `horizontal`, the 0–1 edge inset of the fade on each side. */
  fadeHold?: number;
  tint?: BlurTint;
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
    tintOverride ??
    (theme.scheme === 'dark'
      ? 'systemThinMaterialDark'
      : 'systemThinMaterialLight');
  if (fade === 'none') {
    return (
      <BlurView
        pointerEvents="none"
        tint={tint}
        intensity={intensity}
        style={style}
      />
    );
  }
  const blur = (
    <BlurView
      tint={tint}
      intensity={intensity}
      style={StyleSheet.absoluteFill}
    />
  );
  if (fade === 'horizontal') {
    const edge = Math.min(0.4, Math.max(0.04, fadeHold ?? 0.12));
    return (
      <MaskedView
        pointerEvents="none"
        style={style}
        maskElement={
          <LinearGradient
            colors={EDGE_COLORS}
            locations={[0, edge, 1 - edge, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        {blur}
      </MaskedView>
    );
  }
  if (fade === 'radial') {
    return (
      <MaskedView
        pointerEvents="none"
        style={style}
        maskElement={
          <GradientMask start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} />
        }
      >
        <MaskedView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          maskElement={<GradientMask />}
        >
          {blur}
        </MaskedView>
      </MaskedView>
    );
  }
  const colors =
    fade === 'vertical'
      ? (['transparent', 'black', 'transparent'] as const)
      : fade === 'down'
      ? (['black', 'black', 'transparent'] as const)
      : fadeHold !== undefined && fadeHold > 0
      ? (['transparent', 'black', 'black'] as const)
      : (['transparent', 'black'] as const);
  const hold =
    fade === 'down' || fade === 'up'
      ? Math.min(0.85, Math.max(0, fadeHold ?? (fade === 'down' ? 0.55 : 0)))
      : 0.5;
  const locations =
    fade === 'vertical'
      ? ([0, 0.5, 1] as const)
      : fade === 'down'
      ? ([0, Math.max(hold, 0.001), 1] as const)
      : fadeHold !== undefined && fadeHold > 0
      ? ([0, Math.max(0, Math.min(0.999, 1 - hold)), 1] as const)
      : ([0, 1] as const);
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
      {blur}
    </MaskedView>
  );
}
