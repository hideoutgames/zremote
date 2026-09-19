// Window-sized session wallpaper: cover-fit artwork behind Home, existing
// chats, and new-thread compose. Treatments (dither / ASCII / halftone /
// scanlines) use a static Skia RuntimeEffect — no Reanimated worklets.
// Falls back to the untreated image when the shader or decode fails
// (Jest, Expo Go, compile errors). Mount once at AdaptiveShell / RootPager
// so every surface shares the same crop.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useImage,
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

const SCANLINES = `
uniform shader image;
uniform float light;
half4 main(float2 xy) {
  half4 c = image.eval(xy);
  float gain = mod(floor(xy.y), 3.0) < 0.5 ? 0.52 : 1.0;
  half3 rgb = light > 0.5
    ? c.rgb + (half3(1.0) - c.rgb) * (1.0 - gain)
    : c.rgb * gain;
  return half4(rgb, c.a);
}
`;

const DITHER = `
uniform shader image;
half4 main(float2 xy) {
  half4 c = image.eval(xy);
  float2 p = floor(xy / 2.0);
  float bx = mod(p.x, 4.0);
  float by = mod(p.y, 4.0);
  float bayer = 0.0;
  if (by < 0.5) {
    bayer = bx < 0.5 ? 0.0 : bx < 1.5 ? 8.0 : bx < 2.5 ? 2.0 : 10.0;
  } else if (by < 1.5) {
    bayer = bx < 0.5 ? 12.0 : bx < 1.5 ? 4.0 : bx < 2.5 ? 14.0 : 6.0;
  } else if (by < 2.5) {
    bayer = bx < 0.5 ? 3.0 : bx < 1.5 ? 11.0 : bx < 2.5 ? 1.0 : 9.0;
  } else {
    bayer = bx < 0.5 ? 15.0 : bx < 1.5 ? 7.0 : bx < 2.5 ? 13.0 : 5.0;
  }
  half3 q = floor(c.rgb * 4.0 + ((bayer / 16.0) - 0.5)) / 4.0;
  return half4(clamp(q, 0.0, 1.0), c.a);
}
`;

const HALFTONE = `
uniform shader image;
uniform float light;
half4 main(float2 xy) {
  float2 origin = floor(xy / 4.0) * 4.0;
  half4 sample = image.eval(origin + float2(2.0));
  half4 src = image.eval(xy);
  float luma = dot(sample.rgb, half3(0.299, 0.587, 0.114));
  if (light > 0.5) luma = 1.0 - luma;
  float radius = 2.0 * (0.3 + 0.7 * sqrt(max(luma, 0.0)));
  float dist = length(xy - (origin + float2(1.5)));
  float coverage = clamp(radius + 0.5 - dist, 0.0, 1.0) * sample.a;
  float paper = light > 0.5 ? 1.0 : 0.0;
  half3 mixed = src.rgb * 0.60
    + mix(half3(paper), sample.rgb, coverage) * 0.40;
  return half4(mixed, src.a);
}
`;

const ASCII = `
uniform shader image;
uniform float light;
half4 main(float2 xy) {
  float2 cell = float2(6.0, 8.0);
  float2 origin = floor(xy / cell) * cell;
  half4 sample = image.eval(origin + float2(3.0, 4.0));
  half4 src = image.eval(xy);
  float luma = dot(sample.rgb, half3(0.299, 0.587, 0.114));
  if (light > 0.5) luma = 1.0 - luma;
  float level = floor(sqrt(max(luma, 0.0)) * 9.0 + 0.5);
  float2 local = xy - origin;
  float ink = step(local.x, 4.5) * step(local.y, 6.5) * step(2.5, level);
  float paper = light > 0.5 ? 1.0 : 0.0;
  half3 mixed = src.rgb * 0.60
    + mix(half3(paper), sample.rgb, ink) * 0.40;
  return half4(mixed, src.a);
}
`;

const compile = (src: string) => {
  try {
    return Skia.RuntimeEffect.Make(src);
  } catch {
    return null;
  }
};

const SHADERS = {
  scanlines: compile(SCANLINES),
  dither: compile(DITHER),
  halftone: compile(HALFTONE),
  ascii: compile(ASCII),
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
  const shader = SHADERS[effect];
  if (image == null || shader == null || width <= 0 || height <= 0) {
    return <UntreatedImage uri={uri} />;
  }
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Fill>
        <Shader
          source={shader}
          uniforms={effect === 'dither' ? {} : { light: light ? 1 : 0 }}
        >
          <ImageShader
            image={image}
            fit="cover"
            rect={{ x: 0, y: 0, width, height }}
          />
        </Shader>
      </Fill>
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

export function NewThreadBackground() {
  const theme = useTheme();
  const background = useNewThreadComposerBackground();
  const effect = useNewThreadBackgroundEffect();
  if (background === undefined) return null;
  return (
    <View
      pointerEvents="none"
      testID="new-thread-background"
      style={styles.fill}
    >
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
