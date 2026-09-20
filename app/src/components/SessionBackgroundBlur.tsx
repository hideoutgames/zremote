// Soft wallpaper blur behind the threads list. Compact (iPhone) is
// full-bleed so the image is frosted on the list. Regular iPad sidebar
// is fully frosted (no edge fade) with a darken overlay. Existing-chat
// sessions keep the wallpaper sharp under bubbles; compose does not
// mount this.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { FadeBlur } from './FadeBlur';
import { useNewThreadComposerBackground } from '../zeron/state/uiPrefs';
import { REGULAR_MIN_WIDTH } from '../navigation/layout';

export const COMPACT_THREADS_INTENSITY = 120;
export const REGULAR_THREADS_INTENSITY = 90;
export const SIDEBAR_DARKEN = 'rgba(0,0,0,0.35)';

export type WallpaperBlurSpec = {
  intensity: number;
  fade: 'none' | 'horizontal';
  fadeHold?: number;
};

export const wallpaperBlurFor = (width: number): WallpaperBlurSpec => {
  if (width < REGULAR_MIN_WIDTH) {
    return {
      intensity: COMPACT_THREADS_INTENSITY,
      fade: 'none',
    };
  }
  return {
    intensity: REGULAR_THREADS_INTENSITY,
    fade: 'none',
  };
};

export function ThreadsBackgroundBlur() {
  const background = useNewThreadComposerBackground();
  const { width } = useWindowDimensions();
  if (background === undefined) return null;
  const spec = wallpaperBlurFor(width);
  const dim = width >= REGULAR_MIN_WIDTH;
  return (
    <View
      pointerEvents="none"
      testID="session-background-blur"
      style={styles.layer}
    >
      <FadeBlur
        fade={spec.fade}
        fadeHold={spec.fadeHold}
        intensity={spec.intensity}
        tint="systemThinMaterialDark"
        style={StyleSheet.absoluteFill}
      />
      {dim ? (
        <View
          testID="session-background-dim"
          style={[styles.dim, { backgroundColor: SIDEBAR_DARKEN }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
    alignItems: 'center',
  },
  dim: {
    ...StyleSheet.absoluteFill,
  },
});
