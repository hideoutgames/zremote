// Window-sized session wallpaper: cover-fit artwork behind Home, existing
// chats, and new-thread compose. Treatments (dither / ASCII / halftone /
// scanlines) run live on a Skia Canvas in source-image space (thumbnailed
// to ≤2048, matching desktop) via a static RuntimeEffect, then the
// treated rect is cover-fitted onto the window. Falls back to the untreated
// image when the shader or decode fails (Jest, Expo Go, compile errors).
// Mount once at AdaptiveShell / RootPager so every surface shares the same crop.

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as SkiaNS from '@shopify/react-native-skia';
import { useTheme } from '../theme';
import {
  useNewThreadBackgroundEffect,
  useNewThreadComposerBackground,
} from '../zeron/state/uiPrefs';
import {
  NEW_THREAD_BACKGROUND_FROSTED_OPACITY,
  resolveBackgroundUri,
  type NewThreadBackgroundEffect,
} from '../zeron/state/newThreadBackground';
import {
  averageLuminanceFromRgba,
  contrastSchemeFromLuminance,
  setWallpaperContrast,
} from '../zeron/state/wallpaperContrast';
import {
  ASCII_SKSL,
  DITHER_SKSL,
  HALFTONE_SKSL,
  SCANLINES_SKSL,
  coverFitTransform,
  thumbnailSize,
} from './backgroundEffects';

const compile = (src: string): SkiaNS.SkRuntimeEffect | null => {
  try {
    return SkiaNS.Skia.RuntimeEffect.Make(src);
  } catch {
    return null;
  }
};

const SKSL: Record<Exclude<NewThreadBackgroundEffect, 'none'>, string> = {
  scanlines: SCANLINES_SKSL,
  dither: DITHER_SKSL,
  halftone: HALFTONE_SKSL,
  ascii: ASCII_SKSL,
};

const compiled = new Map<
  Exclude<NewThreadBackgroundEffect, 'none'>,
  SkiaNS.SkRuntimeEffect | null
>();

const shaderFor = (
  effect: Exclude<NewThreadBackgroundEffect, 'none'>,
): SkiaNS.SkRuntimeEffect | null => {
  if (compiled.has(effect)) return compiled.get(effect) ?? null;
  const made = compile(SKSL[effect]);
  compiled.set(effect, made);
  return made;
};

function UntreatedImage({ uri }: { uri: string }) {
  return (
    <ExpoImage
      testID="new-thread-background-untreated"
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
    />
  );
}

function TreatedImage({
  uri,
  effect,
  light,
  width,
  height,
}: {
  uri: string;
  effect: Exclude<NewThreadBackgroundEffect, 'none'>;
  light: boolean;
  width: number;
  height: number;
}) {
  const image = SkiaNS.useImage(uri);
  const shader = shaderFor(effect);
  const rasterLight = effect === 'dither' ? false : light;
  if (image == null || shader == null || width <= 0 || height <= 0) {
    return <UntreatedImage uri={uri} />;
  }
  const thumb = thumbnailSize(image.width(), image.height());
  if (thumb.width <= 0 || thumb.height <= 0) {
    return <UntreatedImage uri={uri} />;
  }
  const transform = coverFitTransform(thumb.width, thumb.height, width, height);
  return (
    <SkiaNS.Canvas
      testID="new-thread-background-treated"
      style={{ width, height }}
      pointerEvents="none"
    >
      <SkiaNS.Group transform={transform}>
        <SkiaNS.Rect x={0} y={0} width={thumb.width} height={thumb.height}>
          <SkiaNS.Shader
            source={shader}
            uniforms={effect === 'dither' ? {} : { light: rasterLight ? 1 : 0 }}
          >
            <SkiaNS.ImageShader
              image={image}
              fit="fill"
              tx="clamp"
              ty="clamp"
              rect={{ x: 0, y: 0, width: thumb.width, height: thumb.height }}
            />
          </SkiaNS.Shader>
        </SkiaNS.Rect>
      </SkiaNS.Group>
    </SkiaNS.Canvas>
  );
}

function Artwork({
  uri,
  effect,
  light,
}: {
  uri: string;
  effect: NewThreadBackgroundEffect;
  light: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      testID="new-thread-background-artwork"
      style={StyleSheet.absoluteFill}
      onLayout={e =>
        setSize({
          w: Math.round(e.nativeEvent.layout.width),
          h: Math.round(e.nativeEvent.layout.height),
        })
      }
    >
      {effect === 'none' || size.w === 0 ? (
        <UntreatedImage uri={uri} />
      ) : (
        <TreatedImage
          uri={uri}
          effect={effect}
          light={light}
          width={size.w}
          height={size.h}
        />
      )}
    </View>
  );
}

const SAMPLE_SIZE = 32;

function WallpaperContrastSampler({ uri }: { uri: string }) {
  const image = SkiaNS.useImage(uri);
  useEffect(() => {
    let cancelled = false;
    setWallpaperContrast(uri, undefined);
    if (image != null) {
      try {
        const srcW = image.width();
        const srcH = image.height();
        const commit = (scheme: 'light' | 'dark') => {
          if (!cancelled) setWallpaperContrast(uri, scheme);
        };
        if (srcW <= 0 || srcH <= 0) {
          commit('dark');
        } else {
          const surface = SkiaNS.Skia.Surface.MakeOffscreen(
            SAMPLE_SIZE,
            SAMPLE_SIZE,
          );
          if (surface == null) {
            commit('dark');
          } else {
            const canvas = surface.getCanvas();
            const paint = SkiaNS.Skia.Paint();
            canvas.drawImageRect(
              image,
              SkiaNS.Skia.XYWHRect(0, 0, srcW, srcH),
              SkiaNS.Skia.XYWHRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE),
              paint,
            );
            const snap = surface.makeImageSnapshot();
            const pixels = snap.readPixels();
            const luma =
              pixels === null || pixels === undefined
                ? undefined
                : averageLuminanceFromRgba(pixels);
            commit(
              luma === undefined ? 'dark' : contrastSchemeFromLuminance(luma),
            );
          }
        }
      } catch {
        if (!cancelled) setWallpaperContrast(uri, 'dark');
      }
    }
    return () => {
      cancelled = true;
    };
  }, [image, uri]);
  return null;
}

export function NewThreadBackground() {
  const theme = useTheme();
  const background = useNewThreadComposerBackground();
  const effect = useNewThreadBackgroundEffect();
  const uri =
    background === undefined ? undefined : resolveBackgroundUri(background);
  useEffect(() => {
    if (uri === undefined) setWallpaperContrast(undefined, undefined);
  }, [uri]);
  if (uri === undefined) return null;
  return (
    <View
      pointerEvents="none"
      testID="new-thread-background"
      style={styles.fill}
    >
      <WallpaperContrastSampler uri={uri} />
      <View
        style={[
          StyleSheet.absoluteFill,
          { opacity: NEW_THREAD_BACKGROUND_FROSTED_OPACITY },
        ]}
      >
        <Artwork uri={uri} effect={effect} light={theme.scheme === 'light'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    zIndex: 0,
  },
});
