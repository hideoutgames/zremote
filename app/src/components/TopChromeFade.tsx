// Chrome dissolve: masked blur sitting under floating header / composer /
// New thread chrome so list content fades as it scrolls under. No light/dark
// color wash — Reduce Transparency drops the blur and leaves the band empty.
// ContentEdgeMask is a viewport alpha mask on the scrolling content itself.

import React, { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { FadeBlur } from './FadeBlur';

export const TOP_CHROME_FADE_BAND = 56;
export const THREADS_BOTTOM_FADE_BAND = 28;
/** Strong blur under chrome so wallpaper remains, without a color wash. */
export const TOP_CHROME_BLUR_INTENSITY = 90;

export function ChromeFade({
  edge,
  inset,
  fadeBand,
  style,
  testID,
}: {
  edge: 'top' | 'bottom';
  /** Opaque plateau covering chrome (header or composer). */
  inset: number;
  fadeBand?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const band =
    fadeBand ??
    (edge === 'top' ? TOP_CHROME_FADE_BAND : THREADS_BOTTOM_FADE_BAND);
  const height = Math.max(inset, 0) + band;
  const fadeHold = height <= 0 ? 0.12 : Math.max(inset, 0) / height;
  return (
    <View
      pointerEvents="none"
      testID={
        testID ?? (edge === 'top' ? 'top-chrome-fade' : 'bottom-chrome-fade')
      }
      style={[
        styles.wrap,
        edge === 'top' ? styles.top : styles.bottom,
        { height },
        style,
      ]}
    >
      <FadeBlur
        fade={edge === 'top' ? 'down' : 'up'}
        fadeHold={fadeHold}
        intensity={TOP_CHROME_BLUR_INTENSITY}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function TopChromeFade({
  inset,
  style,
}: {
  inset: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <ChromeFade edge="top" inset={inset} style={style} />;
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
