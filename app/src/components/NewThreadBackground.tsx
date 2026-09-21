// Window-sized session wallpaper: cover-fit artwork behind Home, existing
// chats, and new-thread compose. Treatments (dither / ASCII / halftone /
// scanlines) raster offscreen in source-image space (thumbnailed to ≤2048,
// matching desktop) via a static RuntimeEffect, then the treated snapshot is
// cover-fitted with ordinary filtered image scaling. Live shading of the
// destination is not used: the binary Bayer/halftone thresholds resample per
// device pixel and alias into block artifacts on non-integer scales. Falls
// back to the untreated image when the shader, decode, or raster fails (Jest,
// Expo Go, compile errors). Mount once at AdaptiveShell / RootPager so every
// surface shares the same crop.

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

// useImage can hand back a GPU texture; raster surfaces cannot sample it, so
// read it back to CPU memory once before thumbnailing and shader-eval.
const rasterImage = (image: SkiaNS.SkImage): SkiaNS.SkImage =>
  image.makeNonTextureImage() ?? image;

const thumbnailImage = (image: SkiaNS.SkImage): SkiaNS.SkImage | null => {
  const srcW = image.width();
  const srcH = image.height();
  const { width, height } = thumbnailSize(srcW, srcH);
  if (width <= 0 || height <= 0) return null;
  if (width === srcW && height === srcH) return image;
  const surface = SkiaNS.Skia.Surface.MakeOffscreen(width, height);
  if (surface == null) return null;
  surface
    .getCanvas()
    .drawImageRectOptions(
      image,
      SkiaNS.Skia.XYWHRect(0, 0, srcW, srcH),
      SkiaNS.Skia.XYWHRect(0, 0, width, height),
      SkiaNS.FilterMode.Linear,
      SkiaNS.MipmapMode.None,
      SkiaNS.Skia.Paint(),
    );
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  return snapshot == null ? null : rasterImage(snapshot);
};

const BLANK_PROBE = 8;

// A rasterized treatment that painted nothing reads back all-zero bytes; the
// untreated image is a better fallback than an invisible wallpaper.
const rasterPaintsContent = (image: SkiaNS.SkImage): boolean => {
  const size = Math.min(BLANK_PROBE, image.width(), image.height());
  if (size <= 0) return false;
  const half = Math.floor(size / 2);
  const x = Math.max(0, Math.floor(image.width() / 2) - half);
  const y = Math.max(0, Math.floor(image.height() / 2) - half);
  try {
    const pixels = image.readPixels(x, y, {
      width: size,
      height: size,
      colorType: SkiaNS.ColorType.RGBA_8888,
      alphaType: SkiaNS.AlphaType.Unpremul,
    });
    if (pixels == null) return true;
    return pixels.some(value => value !== 0);
  } catch {
    return true;
  }
};

const rasterizeBackgroundEffect = (
  image: SkiaNS.SkImage,
  shader: SkiaNS.SkRuntimeEffect,
  effect: Exclude<NewThreadBackgroundEffect, 'none'>,
  light: boolean,
): SkiaNS.SkImage | null => {
  const source = thumbnailImage(rasterImage(image));
  if (source == null) return null;
  const width = source.width();
  const height = source.height();
  if (width <= 0 || height <= 0) return null;
  const surface = SkiaNS.Skia.Surface.MakeOffscreen(width, height);
  if (surface == null) return null;
  const imageShader = source.makeShaderOptions(
    SkiaNS.TileMode.Clamp,
    SkiaNS.TileMode.Clamp,
    SkiaNS.FilterMode.Nearest,
    SkiaNS.MipmapMode.None,
  );
  const uniforms = effect === 'dither' ? [] : [light ? 1 : 0];
  const paint = SkiaNS.Skia.Paint();
  paint.setShader(shader.makeShaderWithChildren(uniforms, [imageShader]));
  surface
    .getCanvas()
    .drawRect(SkiaNS.Skia.XYWHRect(0, 0, width, height), paint);
  surface.flush();
  // Offscreen surfaces are GPU-backed on device; the snapshot's texture is
  // owned by the JS-thread context and draws black from the Canvas render
  // thread, so hand back a CPU copy that any context can upload.
  const snapshot = surface.makeImageSnapshot();
  if (snapshot == null) return null;
  const raster = snapshot.makeNonTextureImage() ?? snapshot;
  if (!rasterPaintsContent(raster)) return null;
  return raster;
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
  const [treated, setTreated] = useState<SkiaNS.SkImage | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTreated(null);
    if (image == null || shader == null) return;
    try {
      const snapshot = rasterizeBackgroundEffect(
        image,
        shader,
        effect,
        rasterLight,
      );
      if (!cancelled) setTreated(snapshot);
    } catch {
      if (!cancelled) setTreated(null);
    }
    return () => {
      cancelled = true;
    };
  }, [image, shader, effect, rasterLight]);
  if (treated == null || width <= 0 || height <= 0) {
    return <UntreatedImage uri={uri} />;
  }
  return (
    <SkiaNS.Canvas
      testID="new-thread-background-treated"
      style={{ width, height }}
      pointerEvents="none"
    >
      <SkiaNS.Image
        image={treated}
        fit="cover"
        x={0}
        y={0}
        width={width}
        height={height}
      />
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
