// Ported from Agents Kit components/ai-elements/context.tsx (Apache-2.0,
// Vercel AI Elements) — circular context-window meter. The composer chip
// is the trigger; tap opens a transparent GlassSheet (same chrome as
// Thought process). Rendered only when the doc's meta carries contextUsage
// (never invented). No tokenlens cost rows: the host only sends
// { tokens, window }.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { ContextUsage } from '../../zeron/protocol/types';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';
import { GlassSheet } from '../GlassSheet';
import {
  CONTEXT_DANGER_RATIO,
  contextRemaining,
  contextUsageRatio,
  formatCompactTokens,
  formatContextPercent,
  resolveContextUsage,
} from './contextUsage';

const CHIP_RING = 16;
const SHEET_RING = 120;

const makeRingPaths = (
  inset: number,
  ovalSize: number,
  ratio: number,
): {
  track: ReturnType<typeof Skia.Path.Make>;
  sweep: ReturnType<typeof Skia.Path.Make> | null;
} | null => {
  try {
    const oval = Skia.XYWHRect(inset, inset, ovalSize, ovalSize);
    const track = Skia.Path.Make();
    if (track == null) return null;
    track.addOval(oval);
    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped <= 0) return { track, sweep: null };
    const sweep = Skia.Path.Make();
    if (sweep == null) return { track, sweep: null };
    sweep.addArc(oval, -90, clamped * 360);
    return { track, sweep };
  } catch {
    // Jest/web Skia has no PathBuilder; device builds draw the arc.
    return null;
  }
};

function ContextUsageRing({
  size,
  ratio,
  color,
  trackColor,
}: {
  size: number;
  ratio: number;
  color: string;
  trackColor: string;
}) {
  const stroke = Math.max(2, (size * 2) / 24);
  const inset = stroke / 2;
  const ovalSize = size - stroke;
  const paths = useMemo(
    () => makeRingPaths(inset, ovalSize, ratio),
    [inset, ovalSize, ratio],
  );

  if (paths === null) {
    return (
      <View
        style={[
          styles.fallbackRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: stroke,
            borderColor: trackColor,
          },
        ]}
      />
    );
  }

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Path
        path={paths.track}
        color={trackColor}
        style="stroke"
        strokeWidth={stroke}
      />
      {paths.sweep !== null ? (
        <Path
          path={paths.sweep}
          color={color}
          style="stroke"
          strokeWidth={stroke}
          strokeCap="round"
        />
      ) : null}
    </Canvas>
  );
}

function ContextUsageSheet({
  tokens,
  maxTokens,
  ratio,
  color,
  trackColor,
  onDismiss,
}: {
  tokens: number;
  maxTokens: number;
  ratio: number;
  color: string;
  trackColor: string;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const percent = formatContextPercent(ratio);
  const used = formatCompactTokens(tokens);
  const total = formatCompactTokens(maxTokens);
  const remaining = formatCompactTokens(contextRemaining(tokens, maxTokens));
  return (
    <GlassSheet title={t('composer.context')} onDismiss={onDismiss}>
      <View style={styles.sheetBody}>
        <View style={styles.hero}>
          <ContextUsageRing
            size={SHEET_RING}
            ratio={ratio}
            color={color}
            trackColor={trackColor}
          />
          <Text
            style={[styles.heroPct, { color: theme.text }]}
            accessibilityElementsHidden
          >
            {percent}
          </Text>
        </View>
        <Text style={[styles.used, { color: theme.text }]}>
          {t('composer.context.used')
            .replace('{used}', used)
            .replace('{total}', total)}
        </Text>
        <Text style={[styles.remaining, { color: theme.textSecondary }]}>
          {t('composer.context.remaining').replace('{count}', remaining)}
        </Text>
      </View>
    </GlassSheet>
  );
}

export const ContextUsageChip = React.memo(function ({
  usage,
}: {
  usage: ContextUsage | undefined;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const resolved = resolveContextUsage(usage);
  if (resolved === undefined) return null;
  const ratio = contextUsageRatio(resolved.tokens, resolved.window);
  const trackColor = theme.sendInactive;
  const color = ratio > CONTEXT_DANGER_RATIO ? theme.danger : theme.text;
  const percent = formatContextPercent(ratio);
  return (
    <>
      <Pressable
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={t('composer.context.a11y').replace(
          '{percent}',
          percent,
        )}
        testID="context-usage-chip"
        onPress={() => setOpen(true)}
        style={styles.chipHit}
      >
        <ContextUsageRing
          size={CHIP_RING}
          ratio={ratio}
          color={color}
          trackColor={trackColor}
        />
      </Pressable>
      {open ? (
        <ContextUsageSheet
          tokens={resolved.tokens}
          maxTokens={resolved.window}
          ratio={ratio}
          color={color}
          trackColor={trackColor}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  fallbackRing: { opacity: 0.35 },
  chipHit: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    width: 32,
  },
  sheetBody: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 10,
  },
  hero: {
    width: SHEET_RING,
    height: SHEET_RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPct: {
    position: 'absolute',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  used: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  remaining: { fontSize: 14, fontVariant: ['tabular-nums'] },
});
