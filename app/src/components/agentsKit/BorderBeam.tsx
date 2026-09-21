// BorderBeam — MIT-licensed Libraries.dev effect
// (components/effects/border-beam/upstream) ported to Skia: a thin stroke
// along the composer's rounded-rect perimeter. Sweep animation lives in
// BorderBeamSweep (the only worklet in this effect) so SessionScreen /
// Composer memo caches cannot be serialized into RCTFatal.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { beamState, type BeamState } from './beamState';
import type { RunPhase, RoomState } from '../../zeron/state/sessionStores';
import { useTheme } from '../../theme';
import { BorderBeamSweep } from './BorderBeamSweep';

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

  if (width <= 0 || height <= 0 || mode === 'off') return null;

  if (mode === 'sweep') {
    return (
      <BorderBeamSweep
        width={width}
        height={height}
        radius={radius}
        color={color}
        speed={state.speed}
      />
    );
  }

  const opacity = mode === 'fading' ? 0.35 : mode === 'stale' ? 0.4 : 1;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width, height }]}
    >
      <Canvas style={{ width, height }}>
        <RoundedRect
          x={STROKE / 2}
          y={STROKE / 2}
          width={width - STROKE}
          height={height - STROKE}
          r={radius}
          color={color}
          style="stroke"
          strokeWidth={STROKE}
          opacity={opacity}
        />
      </Canvas>
    </View>
  );
}
