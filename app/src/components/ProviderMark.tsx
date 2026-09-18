// Provider glyph for composer / picker rows. Marks are the SVGs from
// zeronsh/zeron@853872d crates/ui/assets/icons (MIT). Claude keeps its
// brand orange; the rest tint to the current text color.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, ImageSVG, Skia } from '@shopify/react-native-skia';
import { useTheme } from '../theme';
import type { ProviderKind } from './modelLabel';
import { PROVIDER_MARK_SVG } from './providerMarkSvg';

const CLAUDE_BRAND = '#D97757';

const svgFor = (kind: ProviderKind, color: string) => {
  if (kind === 'generic') return null;
  const xml = PROVIDER_MARK_SVG[kind];
  if (xml === undefined) return null;
  try {
    const make = Skia.SVG?.MakeFromString;
    if (typeof make !== 'function') return null;
    return make(xml.replace(/currentColor/g, color));
  } catch {
    return null;
  }
};

export function ProviderMark({
  kind,
  size = 16,
}: {
  kind: ProviderKind;
  size?: number;
}) {
  const theme = useTheme();
  const tint = kind === 'claude' ? CLAUDE_BRAND : theme.text;
  const svg = useMemo(() => svgFor(kind, tint), [kind, tint]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.wrap, { width: size, height: size }]}
    >
      {svg != null ? (
        <Canvas style={{ width: size, height: size }}>
          <ImageSVG svg={svg} x={0} y={0} width={size} height={size} />
        </Canvas>
      ) : (
        <View
          style={{
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size * 0.18,
            backgroundColor: theme.textSecondary,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
