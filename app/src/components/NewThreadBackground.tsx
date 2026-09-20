// Window-sized session wallpaper: cover-fit artwork behind Home, existing
// chats, and new-thread compose. Treatments (dither / ASCII / halftone /
// scanlines) raster in source-image space (≤2048, matching desktop) via a
// static Skia RuntimeEffect, then the snapshot is cover-fitted. Falls back
// to the untreated image when the shader or decode fails (Jest, Expo Go,
// compile errors). Mount once at AdaptiveShell / RootPager so every surface
// shares the same crop.

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  Canvas,
  FilterMode,
  Image as SkiaImage,
  MipmapMode,
  Skia,
  TileMode,
  useImage,
  type SkImage,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';
import { useTheme } from '../theme';
import {
  useNewThreadBackgroundEffect,
  useNewThreadComposerBackground,
} from '../zeron/state/uiPrefs';
import {
  NEW_THREAD_BACKGROUND_FROSTED_OPACITY,
  type NewThreadBackgroundEffect,
} from '../zeron/state/newThreadBackground';
import {
  averageLuminanceFromRgba,
  contrastSchemeFromLuminance,
  setWallpaperContrast,
} from '../zeron/state/wallpaperContrast';
import {
  ASCII_SKSL,
  BACKGROUND_EFFECT_MAX_EDGE,
  DITHER_SKSL,
  HALFTONE_SKSL,
  SCANLINES_SKSL,
  thumbnailSize,
} from './backgroundEffects';

const compile = (src: string): SkRuntimeEffect | null => {
  try {
    return Skia.RuntimeEffect.Make(src);
  } catch {
    return null;
  }
};

const SHADERS: Record<
  Exclude<NewThreadBackgroundEffect, 'none'>,
  SkRuntimeEffect | null
> = {
  scanlines: compile(SCANLINES_SKSL),
  dither: compile(DITHER_SKSL),
  halftone: compile(HALFTONE_SKSL),
  ascii: compile(ASCII_SKSL),
};

const thumbnailImage = (image: SkImage): SkImage | null => {
  const srcW = image.width();
  const srcH = image.height();
  const { width, height } = thumbnailSize(
    srcW,
    srcH,
    BACKGROUND_EFFECT_MAX_EDGE,
  );
  if (width <= 0 || height <= 0) return null;
  if (width === srcW && height === srcH) return image;
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (surface == null) return null;
  surface
    .getCanvas()
    .drawImageRectOptions(
      image,
      Skia.XYWHRect(0, 0, srcW, srcH),
      Skia.XYWHRect(0, 0, width, height),
      FilterMode.Linear,
      MipmapMode.None,
      Skia.Paint(),
    );
  return surface.makeImageSnapshot();
};

const rasterizeBackgroundEffect = (
  image: SkImage,
  effect: Exclude<NewThreadBackgroundEffect, 'none'>,
  light: boolean,
): SkImage | null => {
  const runtime = SHADERS[effect];
  if (runtime == null) return null;
  const source = thumbnailImage(image);
  if (source == null) return null;
  const width = source.width();
  const height = source.height();
  if (width <= 0 || height <= 0) return null;
  const surface = Skia.Surface.MakeOffscreen(width, height);
  if (surface == null) return null;
  const imageShader = source.makeShaderOptions(
    TileMode.Clamp,
    TileMode.Clamp,
    FilterMode.Nearest,
    MipmapMode.None,
  );
  const uniforms = effect === 'dither' ? [] : [light ? 1 : 0];
  const shader = runtime.makeShaderWithChildren(uniforms, [imageShader]);
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, width, height), paint);
  return surface.makeImageSnapshot();
};

function UntreatedImage({ uri }: { uri: string }) {
  return (
    <ExpoImage
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
  const image = useImage(uri);
  const rasterLight = effect === 'dither' ? false : light;
  const [treated, setTreated] = useState<SkImage | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTreated(null);
    if (image == null) return;
    try {
      const snapshot = rasterizeBackgroundEffect(image, effect, rasterLight);
      if (!cancelled) setTreated(snapshot);
    } catch {
      if (!cancelled) setTreated(null);
    }
    return () => {
      cancelled = true;
    };
  }, [image, effect, rasterLight]);
  if (treated == null || width <= 0 || height <= 0 || SHADERS[effect] == null) {
    return <UntreatedImage uri={uri} />;
  }
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <SkiaImage
        image={treated}
        fit="cover"
        x={0}
        y={0}
        width={width}
        height={height}
      />
    </Canvas>
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
  const image = useImage(uri);
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
          const surface = Skia.Surface.MakeOffscreen(SAMPLE_SIZE, SAMPLE_SIZE);
          if (surface == null) {
            commit('dark');
          } else {
            const canvas = surface.getCanvas();
            const paint = Skia.Paint();
            canvas.drawImageRect(
              image,
              Skia.XYWHRect(0, 0, srcW, srcH),
              Skia.XYWHRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE),
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
  useEffect(() => {
    if (background === undefined) setWallpaperContrast(undefined, undefined);
  }, [background]);
  if (background === undefined) return null;
  return (
    <View
      pointerEvents="none"
      testID="new-thread-background"
      style={styles.fill}
    >
      <WallpaperContrastSampler uri={background.uri} />
      <View
        style={[
          StyleSheet.absoluteFill,
          { opacity: NEW_THREAD_BACKGROUND_FROSTED_OPACITY },
        ]}
      >
        <Artwork
          uri={background.uri}
          effect={effect}
          light={theme.scheme === 'light'}
        />
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
