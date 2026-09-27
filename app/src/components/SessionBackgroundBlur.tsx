// Heavy frosted-glass wallpaper behind the threads list and, optionally,
// open sessions. UIBlurEffect intensity caps at 100, and a single pass
// cannot exceed that style's radius, so each surface stacks two chrome
// materials. Compact (iPhone) is full-bleed. Regular iPad sidebar is
// fully frosted (no edge fade) with a darken overlay. Session blur
// (pref) uses the same intensity with a light chrome material and no
// overlay. Compose does not mount either layer.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { BlurTint } from 'expo-blur';
import { FadeBlur } from './FadeBlur';
import {
  useNewThreadComposerBackground,
  useSessionBackgroundBlur,
} from '../zeron/state/uiPrefs';
import { REGULAR_MIN_WIDTH } from '../navigation/layout';

export const COMPACT_THREADS_INTENSITY = 100;
export const REGULAR_THREADS_INTENSITY = 100;
/** Second pass re-blurs the first; one UIBlurEffect cannot go further. */
export const WALLPAPER_BLUR_PASSES = 2;
export const SIDEBAR_DARKEN = 'rgba(0,0,0,0.35)';
export const THREADS_BACKGROUND_BLUR_TINT = 'systemChromeMaterialDark' as const;
export const CHAT_BACKGROUND_BLUR_TINT = 'systemChromeMaterialLight' as const;

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

function WallpaperBlurStack({
  spec,
  tint,
}: {
  spec: WallpaperBlurSpec;
  tint: BlurTint;
}) {
  return (
    <>
      {Array.from({ length: WALLPAPER_BLUR_PASSES }, (_, index) => (
        <FadeBlur
          key={index}
          fade={spec.fade}
          fadeHold={spec.fadeHold}
          intensity={spec.intensity}
          tint={tint}
          style={StyleSheet.absoluteFill}
        />
      ))}
    </>
  );
}

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
      <WallpaperBlurStack spec={spec} tint={THREADS_BACKGROUND_BLUR_TINT} />
      {dim ? (
        <View
          testID="session-background-dim"
          style={[styles.dim, { backgroundColor: SIDEBAR_DARKEN }]}
        />
      ) : null}
    </View>
  );
}

export function ChatBackgroundBlur() {
  const background = useNewThreadComposerBackground();
  const enabled = useSessionBackgroundBlur();
  const { width } = useWindowDimensions();
  if (background === undefined || !enabled) return null;
  const spec = wallpaperBlurFor(width);
  return (
    <View
      pointerEvents="none"
      testID="chat-background-blur"
      style={styles.layer}
    >
      <WallpaperBlurStack spec={spec} tint={CHAT_BACKGROUND_BLUR_TINT} />
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
