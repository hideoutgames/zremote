// Soft wallpaper blur behind the threads list and the existing-chat
// content column. Compact (iPhone) is full-bleed so the image is frosted
// everywhere except new-thread compose, which does not mount this.
// Regular iPad sidebar is fully frosted (no edge fade) with a darken
// overlay; chat uses a wide column so bubbles sit on blur, not sharp art.

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { FadeBlur } from './FadeBlur';
import { useNewThreadComposerBackground } from '../zeron/state/uiPrefs';
import { REGULAR_MIN_WIDTH } from '../navigation/layout';

export const COMPACT_WALLPAPER_BLUR = 80;
export const REGULAR_THREADS_INTENSITY = 42;
export const REGULAR_CHAT_INTENSITY = 36;
export const REGULAR_CHAT_COLUMN_EDGE = 0.1;
export const REGULAR_CHAT_VIGNETTE_EDGE = 0.08;
export const SIDEBAR_DARKEN = 'rgba(0,0,0,0.35)';
/** Extra width beyond the transcript measure cap so iPad blur covers bubbles. */
export const CHAT_BLUR_EXTRA = 280;

export type WallpaperBlurSpec = {
  intensity: number;
  fade: 'none' | 'horizontal';
  fadeHold?: number;
};

export const wallpaperBlurFor = (
  width: number,
  kind: 'threads' | 'chat',
  column = false,
): WallpaperBlurSpec => {
  if (width < REGULAR_MIN_WIDTH) {
    return { intensity: COMPACT_WALLPAPER_BLUR, fade: 'none' };
  }
  if (kind === 'threads') {
    return {
      intensity: REGULAR_THREADS_INTENSITY,
      fade: 'none',
    };
  }
  return {
    intensity: REGULAR_CHAT_INTENSITY,
    fade: 'horizontal',
    fadeHold: column ? REGULAR_CHAT_COLUMN_EDGE : REGULAR_CHAT_VIGNETTE_EDGE,
  };
};

export const chatBlurMaxWidth = (
  contentMaxWidth?: number,
): number | undefined =>
  contentMaxWidth === undefined
    ? undefined
    : contentMaxWidth + CHAT_BLUR_EXTRA * 2;

export function ThreadsBackgroundBlur() {
  const background = useNewThreadComposerBackground();
  const { width } = useWindowDimensions();
  if (background === undefined) return null;
  const spec = wallpaperBlurFor(width, 'threads');
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

export function ChatBackgroundBlur({
  contentMaxWidth,
}: {
  contentMaxWidth?: number;
}) {
  const background = useNewThreadComposerBackground();
  const { width } = useWindowDimensions();
  if (background === undefined) return null;
  const column = contentMaxWidth !== undefined;
  const spec = wallpaperBlurFor(width, 'chat', column);
  const blurWidth = chatBlurMaxWidth(contentMaxWidth);
  const paddedColumn = column && spec.fade === 'horizontal';
  return (
    <View
      pointerEvents="none"
      testID="chat-background-blur"
      style={styles.layer}
    >
      <View
        style={
          paddedColumn
            ? [styles.column, { maxWidth: blurWidth }]
            : StyleSheet.absoluteFill
        }
      >
        <FadeBlur
          fade={spec.fade}
          fadeHold={spec.fadeHold}
          intensity={spec.intensity}
          style={StyleSheet.absoluteFill}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  column: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  dim: {
    ...StyleSheet.absoluteFill,
  },
});
