// Port of official iOS Loaders.swift WorkingSpinner + SessionView status strip.
// RN Animated / interval only — no Reanimated worklets (SessionScreen forbids them).
/* eslint-disable react-native/no-inline-styles -- cell size/opacity are per-frame */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { flavourSeed, flavourWord } from './workingMotion';
import { formatWorkingElapsed } from '../zeron/state/workingElapsed';

const ROW_TINTS = ['#B6D3EF', '#EDB185', '#F888A0'] as const;
const DIM = 0.1;
const PERIOD_MS = 750;
const IN_TEST = process.env.JEST_WORKER_ID !== undefined;

const gspinOpacity = (phase: number): number => {
  const p = phase - Math.floor(phase);
  if (p < 0.45) {
    const t = p / 0.45;
    const smooth = t * t * (3 - 2 * t);
    return 1 - (1 - DIM) * smooth;
  }
  if (p < 0.92) return DIM;
  const t = (p - 0.92) / 0.08;
  return DIM + (1 - DIM) * t;
};

export function WorkingSpinner({ cellSize = 2.5 }: { cellSize?: number }) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (reduceMotion || IN_TEST) return;
    const id = setInterval(() => setNow(Date.now()), 80);
    return () => clearInterval(id);
  }, [reduceMotion]);
  const t = now / PERIOD_MS;
  const gap = cellSize * 0.8;
  return (
    <View
      testID="working-spinner"
      style={styles.grid}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map(row => (
        <View key={row} style={[styles.row, { gap }]}>
          {[0, 1, 2].map(col => {
            const dx = col - 1;
            const dy = 2 - row;
            const dist = Math.sqrt(dx * dx + dy * dy) / 2.5;
            return (
              <View
                key={col}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: ROW_TINTS[row],
                    opacity: reduceMotion ? 1 : gspinOpacity(t - dist),
                  },
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function WorkingWaitLabel({
  chatId,
  startedAt,
  fallback,
}: {
  chatId?: string;
  startedAt: number;
  fallback: string;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (IN_TEST) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const label =
    chatId !== undefined
      ? `${flavourWord(flavourSeed(chatId), elapsed)}…`
      : fallback;
  return (
    <View style={styles.waitRow} testID="working-wait">
      <WorkingSpinner />
      <Text
        style={[styles.waitLabel, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** Reserved 24pt strip above the composer (SessionView.statusStrip). */
export function WorkingStatusStrip({
  chatId,
  startedAt,
  working,
}: {
  chatId: string;
  startedAt: number;
  working: boolean;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working || IN_TEST) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [working]);
  const elapsedSecs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <View style={styles.strip} testID="working-status-strip">
      {working ? (
        <>
          <WorkingSpinner />
          <Text
            style={[styles.flavour, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {`${flavourWord(flavourSeed(chatId), elapsedSecs)}…`}
          </Text>
          <Text
            style={[styles.elapsed, { color: theme.textSecondary }]}
            testID="working-status-elapsed"
          >
            {formatWorkingElapsed(startedAt, now)}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 2, justifyContent: 'center' },
  row: { flexDirection: 'row' },
  cell: {},
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitLabel: { fontSize: 16, flexShrink: 1 },
  strip: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 26,
  },
  flavour: { fontSize: 12, flexShrink: 1 },
  elapsed: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
