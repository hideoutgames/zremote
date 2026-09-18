// Renders a vendored SVG mark via Skia. Falls back to an empty box when
// the SVG cannot be parsed (Jest / missing mark).

import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, ImageSVG, Skia } from '@shopify/react-native-skia';

export function BrandMark({
  svg,
  size = 16,
}: {
  svg: string | undefined;
  size?: number;
}) {
  const picture = useMemo(() => {
    if (svg === undefined || svg === '') return null;
    try {
      return Skia.SVG.MakeFromString(svg);
    } catch {
      return null;
    }
  }, [svg]);

  if (picture == null) {
    return <View style={{ width: size, height: size }} />;
  }
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <ImageSVG svg={picture} width={size} height={size} />
    </Canvas>
  );
}
