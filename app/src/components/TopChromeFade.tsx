// Chrome dissolve: masked blur sitting under floating header / composer /
// New thread chrome so list content fades as it scrolls under. Optional
// black wash (wallpaper on Home) — Reduce Transparency drops both the
// blur and the wash. ContentEdgeMask is a viewport alpha mask on the
// scrolling content itself.

import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import type { BlurTint } from 'expo-blur';
import { FadeBlur } from './FadeBlur';

export const TOP_CHROME_FADE_BAND = 56;
/** Strong blur under chrome so wallpaper remains. */
export const TOP_CHROME_BLUR_INTENSITY = 90;
/** Black edge wash when a session wallpaper is set on Home. */
export const CHROME_FADE_WASH_DARK = 'rgba(0,0,0,0.78)';

function ChromeFadeWash({
  edge,
  fadeHold,
  wash,
}: {
  edge: 'top' | 'bottom';
  fadeHold: number;
  wash: string;
}) {
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
  const hold = Math.min(0.85, Math.max(0, fadeHold));
  const colors =
    edge === 'top'
      ? ([wash, wash, 'transparent'] as const)
      : hold > 0
      ? (['transparent', wash, wash] as const)
      : (['transparent', wash] as const);
  const locations =
    edge === 'top'
      ? ([0, Math.max(hold, 0.001), 1] as const)
      : hold > 0
      ? ([0, Math.max(0, Math.min(0.999, 1 - hold)), 1] as const)
      : ([0, 1] as const);
  return (
    <LinearGradient
      testID="chrome-fade-wash"
      pointerEvents="none"
      colors={[...colors] as [string, string, ...string[]]}
      locations={[...locations] as [number, number, ...number[]]}
      style={StyleSheet.absoluteFill}
    />
  );
}

export function ChromeFade({
  edge,
  inset,
  fadeBand,
  style,
  testID,
  wash,
  tint,
  animatedStyle,
}: {
  edge: 'top' | 'bottom';
  /** Opaque plateau covering chrome (header or composer). */
  inset: number;
  fadeBand?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  wash?: string;
  tint?: BlurTint;
  /** Live height (grabber pan) — last so it overrides the committed height. */
  animatedStyle?: AnimatedStyle<ViewStyle>;
}) {
  const band = fadeBand ?? TOP_CHROME_FADE_BAND;
  const height = Math.max(inset, 0) + band;
  const fadeHold = height <= 0 ? 0.12 : Math.max(inset, 0) / height;
  return (
    <Animated.View
      pointerEvents="none"
      testID={
        testID ?? (edge === 'top' ? 'top-chrome-fade' : 'bottom-chrome-fade')
      }
      style={[
        styles.wrap,
        edge === 'top' ? styles.top : styles.bottom,
        { height },
        style,
        animatedStyle,
      ]}
    >
      <FadeBlur
        fade={edge === 'top' ? 'down' : 'up'}
        fadeHold={fadeHold}
        intensity={TOP_CHROME_BLUR_INTENSITY}
        tint={tint}
        style={StyleSheet.absoluteFill}
      />
      {wash !== undefined ? (
        <ChromeFadeWash edge={edge} fadeHold={fadeHold} wash={wash} />
      ) : null}
    </Animated.View>
  );
}

export function TopChromeFade({
  inset,
  style,
  wash,
  tint,
}: {
  inset: number;
  style?: StyleProp<ViewStyle>;
  wash?: string;
  tint?: BlurTint;
}) {
  return (
    <ChromeFade
      edge="top"
      inset={inset}
      style={style}
      wash={wash}
      tint={tint}
    />
  );
}

/** Build 0–1 gradient stops for a viewport content mask. */
export const maskStopsFor = (
  height: number,
  topInset: number,
  topBand: number,
  bottomInset: number,
  bottomBand: number,
): { colors: string[]; locations: number[] } => {
  if (height <= 0) {
    return {
      colors: ['black', 'black'],
      locations: [0, 1],
    };
  }
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const raw = [
    { loc: 0, color: 'transparent' },
    { loc: clamp01(topInset / height), color: 'transparent' },
    { loc: clamp01((topInset + topBand) / height), color: 'black' },
    {
      loc: clamp01(1 - (bottomInset + bottomBand) / height),
      color: 'black',
    },
    { loc: clamp01(1 - bottomInset / height), color: 'transparent' },
    { loc: 1, color: 'transparent' },
  ];
  const colors: string[] = [];
  const locations: number[] = [];
  for (const stop of raw) {
    if (locations.length === 0) {
      colors.push(stop.color);
      locations.push(stop.loc);
      continue;
    }
    const prev = locations[locations.length - 1];
    if (stop.loc <= prev) {
      locations[locations.length - 1] = prev;
      colors[colors.length - 1] = stop.color;
      continue;
    }
    colors.push(stop.color);
    locations.push(stop.loc);
  }
  if (locations[0] > 0) {
    colors.unshift(colors[0]);
    locations.unshift(0);
  }
  if (locations[locations.length - 1] < 1) {
    colors.push(colors[colors.length - 1]);
    locations.push(1);
  }
  return { colors, locations };
};

function EdgeFadeGradient({
  topInset,
  topBand,
  bottomInset,
  bottomBand,
}: {
  topInset: number;
  topBand: number;
  bottomInset: number;
  bottomBand: number;
}) {
  const [height, setHeight] = useState(0);
  const stops = maskStopsFor(
    height,
    topInset,
    topBand,
    bottomInset,
    bottomBand,
  );
  return (
    <View
      style={styles.fill}
      onLayout={e => {
        const h = e.nativeEvent.layout.height;
        setHeight(prev => (prev === h ? prev : h));
      }}
    >
      <LinearGradient
        colors={stops.colors as [string, string, ...string[]]}
        locations={stops.locations as [number, number, ...number[]]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function ContentEdgeMask({
  children,
  topInset,
  topBand = TOP_CHROME_FADE_BAND,
  bottomInset,
  bottomBand,
  testID = 'content-edge-mask',
}: {
  children: React.ReactNode;
  topInset: number;
  topBand?: number;
  bottomInset: number;
  bottomBand: number;
  testID?: string;
}) {
  return (
    <MaskedView
      testID={testID}
      style={styles.fill}
      maskElement={
        <EdgeFadeGradient
          topInset={topInset}
          topBand={topBand}
          bottomInset={bottomInset}
          bottomBand={bottomBand}
        />
      }
    >
      {children}
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
