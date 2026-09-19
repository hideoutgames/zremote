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

function ContextUsageRing({
  size,
  ratio,
  color,
}: {
  size: number;
  ratio: number;
  color: string;
}) {
  const stroke = Math.max(2, (size * 2) / 24);
  const inset = stroke / 2;
  const ovalSize = size - stroke;
  const track = useMemo(() => {
    const p = Skia.Path.Make();
    p.addOval(Skia.XYWHRect(inset, inset, ovalSize, ovalSize));
    return p;
  }, [inset, ovalSize]);
  const sweep = useMemo(() => {
    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped <= 0) return null;
    const p = Skia.Path.Make();
    p.addArc(
      Skia.XYWHRect(inset, inset, ovalSize, ovalSize),
      -90,
      clamped * 360,
    );
    return p;
  }, [inset, ovalSize, ratio]);

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Path
        path={track}
        color={color}
        style="stroke"
        strokeWidth={stroke}
        opacity={0.2}
      />
      {sweep !== null ? (
        <Path
          path={sweep}
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
  onDismiss,
}: {
  tokens: number;
  maxTokens: number;
  ratio: number;
  color: string;
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
          <ContextUsageRing size={SHEET_RING} ratio={ratio} color={color} />
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
  const color =
    ratio > CONTEXT_DANGER_RATIO ? theme.danger : theme.indicatorWorking;
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
        <ContextUsageRing size={CHIP_RING} ratio={ratio} color={color} />
        <Text style={[styles.chipPct, { color: theme.text }]}>{percent}</Text>
      </Pressable>
      {open ? (
        <ContextUsageSheet
          tokens={resolved.tokens}
          maxTokens={resolved.window}
          ratio={ratio}
          color={color}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  chipHit: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    paddingHorizontal: 4,
    gap: 4,
  },
  chipPct: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
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
