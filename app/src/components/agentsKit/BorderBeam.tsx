// BorderBeam — MIT-licensed Libraries.dev effect
// (components/effects/border-beam/upstream) ported to Skia + Reanimated: a
// thin stroke along the composer's rounded-rect perimeter with a sweeping
// gradient segment. Behavior is driven by the pure `beamState` mapping
// (working → sweep, awaitingInput → static amber, stale/disconnected → dim
// static, stopping → slowed sweep, terminal → fading). Reduce Motion →
// static ring; the loop only runs while sweeping and the app is active.

import React, { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Group,
  RoundedRect,
  SweepGradient,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { beamState, type BeamState } from './beamState';
import type { RunPhase, RoomState } from '../../zeron/state/sessionStores';
import { useTheme } from '../../theme';

export interface BorderBeamProps {
  width: number;
  height: number;
  radius: number;
  runPhase: RunPhase;
  roomState: RoomState;
  reduceMotion: boolean;
  /** isReduceTransparencyEnabled — bump contrast when transparency is off. */
  highContrast?: boolean;
}

const STROKE = 2;

export function BorderBeam({
  width,
  height,
  radius,
  runPhase,
  roomState,
  reduceMotion,
  highContrast = false,
}: BorderBeamProps) {
  'use no memo';
  const theme = useTheme();
  const state: BeamState = beamState(runPhase, roomState, reduceMotion);

  const colorFor = (key: BeamState['color']): string => {
    switch (key) {
      case 'accent':
        return highContrast ? theme.text : theme.accent;
      case 'amber':
        return theme.indicatorAwaitingInput;
      case 'fading':
        return theme.textSecondary;
      default:
        return theme.border;
    }
  };
  const color = colorFor(state.color);
  const mode = state.mode;
  const speed = state.speed;

  // Skia clock: ms since mount; the sweep angle derives from it so a paused
  // render simply freezes the beam (mode≠sweep ignores it anyway).
  const clock = useClock();
  const appActive = useSharedValue(1);
  useEffect(() => {
    const sub = AppState.addEventListener(
      'change',
      s =>
        (appActive.value = withTiming(s === 'active' ? 1 : 0, {
          duration: 0,
        })),
    );
    return () => sub.remove();
  }, [appActive]);

  const opacity = useDerivedValue(() => {
    if (mode === 'off') return 0;
    if (mode === 'fading') return 0.35;
    return 1;
  });

  const transform = useDerivedValue(() => {
    if (mode !== 'sweep' || appActive.value === 0) return [{ rotate: 0 }];
    const turns = (clock.value / 1000) * speed;
    return [{ rotate: (turns % 1) * Math.PI * 2 }];
  });

  if (width <= 0 || height <= 0 || mode === 'off') return null;
  const cx = width / 2;
  const cy = height / 2;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width, height }]}
    >
      <Canvas style={{ width, height }}>
        <Group opacity={opacity}>
          {/* Dim base ring for the dashed/stale look. */}
          {mode === 'stale' ? (
            <RoundedRect
              x={STROKE / 2}
              y={STROKE / 2}
              width={width - STROKE}
              height={height - STROKE}
              r={radius}
              color={color}
              style="stroke"
              strokeWidth={STROKE}
              opacity={0.4}
            />
          ) : (
            <RoundedRect
              x={STROKE / 2}
              y={STROKE / 2}
              width={width - STROKE}
              height={height - STROKE}
              r={radius}
              style="stroke"
              strokeWidth={STROKE}
            >
              <SweepGradient
                c={vec(cx, cy)}
                colors={[
                  'transparent',
                  'transparent',
                  color,
                  color,
                  'transparent',
                ]}
                transform={transform}
                origin={vec(cx, cy)}
              />
            </RoundedRect>
          )}
        </Group>
      </Canvas>
    </View>
  );
}
