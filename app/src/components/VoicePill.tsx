// VoicePill — RN port of React Bits Voice Pill
// (https://reactbits.dev/c/micro/voice-pill): a 32pt mic that opens left
// into a capsule with a scrolling simulated waveform, elapsed clock, and
// stop square. Listening is controlled by the parent (dictation port).

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from './Icon';

const LOOP = 4.8;
const SYLLABLES: ReadonlyArray<readonly [number, number, number]> = [
  [0.1, 0.16, 0.9],
  [0.3, 0.12, 0.7],
  [0.5, 0.2, 1],
  [0.95, 0.14, 0.8],
  [1.15, 0.1, 0.6],
  [1.3, 0.22, 0.95],
  [1.9, 0.16, 0.85],
  [2.12, 0.12, 0.7],
  [2.3, 0.18, 0.9],
  [2.55, 0.1, 0.5],
  [3.05, 0.24, 1],
  [3.4, 0.12, 0.75],
  [3.6, 0.16, 0.9],
];
const WAVE_EVERY_MS = 80;
const WAVE_MAX = 20;
const OPEN_MS = 200;
const PRESS_SCALE = 0.95;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const simulatedLevel = (t: number): number => {
  const u = t % LOOP;
  let a = 0.06;
  for (const [s, d, p] of SYLLABLES) {
    const x = (u - s) / d;
    if (x >= 0 && x <= 1) {
      a = Math.max(a, p * 0.5 * (1 - Math.cos(2 * Math.PI * x)));
    }
  }
  return a * (0.7 + 0.3 * Math.abs(Math.sin(2 * Math.PI * 7.1 * u)));
};

export const formatElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface VoicePillProps {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  size?: number;
  accentColor: string;
  iconColor: string;
  background: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export function VoicePill({
  active,
  disabled = false,
  onPress,
  size = 32,
  accentColor,
  iconColor,
  background,
  accessibilityLabel,
  accessibilityHint,
}: VoicePillProps) {
  const reduceMotion = useReducedMotion();
  const timeSize = Math.max(10, Math.round(size * 0.36));
  const clockW = Math.round(timeSize * 2.5) + 4;
  const waveW = Math.round(size * 1.9);
  const reach = 8;
  const expanded = size + reach + clockW + waveW;
  const stop = Math.round(size * 0.32);
  const iconSize = Math.round(size * 0.54);
  const floor = 0.1;

  const width = useSharedValue(active ? expanded : size);
  const scale = useSharedValue(1);
  const [hist, setHist] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState('0:00');
  const startedAt = useRef(0);

  useEffect(() => {
    width.value = withTiming(active ? expanded : size, {
      duration: reduceMotion ? 0 : OPEN_MS,
      easing: EASE_OUT,
    });
  }, [active, expanded, reduceMotion, size, width]);

  useEffect(() => {
    if (!active) {
      setHist([]);
      setElapsed('0:00');
      return;
    }
    startedAt.current = Date.now();
    setElapsed('0:00');
    if (reduceMotion) {
      setHist(Array.from({ length: WAVE_MAX }, () => floor));
      return;
    }
    const id = setInterval(() => {
      const now = Date.now();
      setElapsed(formatElapsed(now - startedAt.current));
      const level = simulatedLevel((now - startedAt.current) / 1000);
      setHist(h => {
        const next = h.length >= WAVE_MAX ? h.slice(1) : h.slice();
        next.push(level);
        return next;
      });
    }, WAVE_EVERY_MS);
    return () => clearInterval(id);
  }, [active, reduceMotion]);

  const capsuleStyle = useAnimatedStyle(() => ({
    width: width.value,
    transform: [{ scale: scale.value }],
  }));

  const waveH = size * 0.64;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected: active }}
      onPressIn={() => {
        scale.value = withTiming(PRESS_SCALE, {
          duration: reduceMotion ? 0 : 80,
        });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, {
          duration: reduceMotion ? 0 : 160,
          easing: EASE_OUT,
        });
      }}
      style={styles.hit}
    >
      <Animated.View
        style={[
          styles.capsule,
          {
            height: size,
            borderRadius: size / 2,
            backgroundColor: background,
            opacity: disabled ? 0.55 : 1,
          },
          capsuleStyle,
        ]}
      >
        <View style={[styles.wave, { width: waveW, height: waveH }]}>
          {hist.map((v, i) => {
            const h = Math.max(2, (floor + (1 - floor) * v) * waveH);
            return (
              <View
                key={i}
                style={{
                  width: 2,
                  height: h,
                  borderRadius: 1,
                  backgroundColor: accentColor,
                  opacity: 0.35 + 0.65 * v,
                }}
              />
            );
          })}
        </View>
        <Text
          style={[
            styles.time,
            {
              width: clockW,
              fontSize: timeSize,
              color: accentColor,
              opacity: active ? 1 : 0,
            },
          ]}
        >
          {elapsed}
        </Text>
        <View style={[styles.glyph, { width: size, height: size }]}>
          {active ? (
            <View
              style={{
                width: stop,
                height: stop,
                borderRadius: stop * 0.22,
                backgroundColor: accentColor,
              }}
            />
          ) : (
            <Icon name={'mic' as never} size={iconSize} color={iconColor} />
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { flexShrink: 0 },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    alignSelf: 'flex-end',
    flexShrink: 0,
    minWidth: 32,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 1,
    overflow: 'hidden',
  },
  time: {
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  glyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
