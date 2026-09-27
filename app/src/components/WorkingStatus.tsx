// Port of official iOS Loaders.swift WorkingSpinner + SessionView status.
// RN Animated / interval only — no Reanimated worklets (SessionScreen forbids them).
/* eslint-disable react-native/no-inline-styles -- cell size/opacity are per-frame */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { flavourSeed, flavourWord } from './workingMotion';
import { formatWorkingElapsed } from '../zeron/state/workingElapsed';
import { FrostedBubble } from './transcript/FrostedBubble';

const ROW_TINTS = ['#B6D3EF', '#EDB185', '#F888A0'] as const;
const DIM = 0.1;
const PERIOD_MS = 750;
const IN_TEST = process.env.JEST_WORKER_ID !== undefined;

/** Samples of gspinOpacity: smoothstep 1→DIM over the first 45%, hold,
 * then rise back to 1. Native-driver interpolation, so the grid does not
 * commit React state 12 times a second. */
const SPIN_INPUT = [0, 0.15, 0.3, 0.45, 0.92, 1];
const SPIN_OUTPUT = [1, 0.767, 0.333, DIM, DIM, 1];

function SpinCell({
  row,
  col,
  cellSize,
  reduceMotion,
}: {
  row: number;
  col: number;
  cellSize: number;
  reduceMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const dx = col - 1;
  const dy = 2 - row;
  const dist = Math.sqrt(dx * dx + dy * dy) / 2.5;
  const frozen = reduceMotion || IN_TEST;
  useEffect(() => {
    if (frozen) return;
    let loop: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(() => {
      progress.setValue(0);
      loop = Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: PERIOD_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    }, dist * PERIOD_MS);
    return () => {
      clearTimeout(timer);
      loop?.stop();
    };
  }, [frozen, dist, progress]);
  const opacity = progress.interpolate({
    inputRange: SPIN_INPUT,
    outputRange: SPIN_OUTPUT,
  });
  return (
    <Animated.View
      style={[
        styles.cell,
        {
          width: cellSize,
          height: cellSize,
          backgroundColor: ROW_TINTS[row],
          opacity: frozen ? 1 : opacity,
        },
      ]}
    />
  );
}

export function WorkingSpinner({ cellSize = 2.5 }: { cellSize?: number }) {
  const reduceMotion = useReducedMotion() === true;
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
          {[0, 1, 2].map(col => (
            <SpinCell
              key={col}
              row={row}
              col={col}
              cellSize={cellSize}
              reduceMotion={reduceMotion}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Trailing transcript row while the agent is working (flavour + elapsed). */
export function WorkingStatusRow({
  chatId,
  startedAt,
  compact = false,
}: {
  chatId: string;
  startedAt: number;
  compact?: boolean;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (IN_TEST) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedSecs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <View
      style={[styles.statusRow, compact ? styles.statusRowCompact : undefined]}
      testID="working-status-strip"
      accessibilityLiveRegion="polite"
    >
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
    </View>
  );
}

/** Standalone assistant bubble used when the agent is working and the last
 *  transcript row is not yet an assistant message. */
export function WorkingStatusBubble({
  chatId,
  startedAt,
}: {
  chatId: string;
  startedAt: number;
}) {
  const theme = useTheme();
  return (
    <View style={styles.bubbleRow}>
      <FrostedBubble
        testID="assistant-bubble"
        style={styles.bubble}
        contentStyle={styles.bubblePad}
        tintColor={theme.assistantBubbleBackground}
      >
        <WorkingStatusRow compact chatId={chatId} startedAt={startedAt} />
      </FrostedBubble>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 2, justifyContent: 'center' },
  row: { flexDirection: 'row' },
  cell: {},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusRowCompact: {
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  flavour: { fontSize: 16, flexShrink: 1 },
  elapsed: { fontSize: 13, fontVariant: ['tabular-nums'] },
  bubbleRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    borderRadius: 20,
  },
  bubblePad: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
