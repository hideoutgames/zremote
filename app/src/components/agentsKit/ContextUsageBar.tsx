// Ported from Agents Kit components/ai-elements/context.tsx (Apache-2.0,
// Vercel AI Elements) — circular context-window ring for the composer
// (left of dictation). Rendered only when the doc's meta carries
// contextUsage (never invented).

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { ContextUsage } from '../../zeron/protocol/types';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

const SIZE = 22;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CX = SIZE / 2;

export const compactTokens = (n: number): string => {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
};

const ringPath = () => {
  const p = Skia.Path.Make();
  p.addCircle(CX, CX, RADIUS);
  return p;
};

export const ContextUsageBar = React.memo(function ({
  usage,
}: {
  usage: ContextUsage | undefined;
}) {
  const theme = useTheme();
  if (usage === undefined || usage.tokens == null || usage.window == null)
    return null;
  const ratio = Math.max(0, Math.min(1, usage.tokens / usage.window));
  const pct = Math.round(ratio * 100);
  const color = ratio > 0.9 ? theme.danger : theme.accent;
  const path = ringPath();
  return (
    <View
      testID="contextUsageBar"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t('composer.context')}, ${pct} percent, ${compactTokens(
        usage.tokens,
      )} of ${compactTokens(usage.window)}`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={styles.wrap}
    >
      <Canvas style={styles.canvas}>
        <Path
          path={path}
          style="stroke"
          strokeWidth={STROKE}
          color={theme.border}
        />
        <Path
          path={path}
          style="stroke"
          strokeWidth={STROKE}
          color={color}
          start={0}
          end={Math.max(0.02, ratio)}
        />
      </Canvas>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  canvas: { width: SIZE, height: SIZE },
});
