// Sweep-only Skia child. Parent BorderBeam has no worklets; this file only
// closes over numbers + SharedValues so React Compiler cannot pack a session
// memo cache into extractSerializableOrThrow.

import React, { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import {
  Canvas,
  Group,
  RoundedRect,
  SweepGradient,
  useClock,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const STROKE = 2;

export function BorderBeamSweep({
  width,
  height,
  radius,
  color,
  speed,
}: {
  width: number;
  height: number;
  radius: number;
  color: string;
  speed: number;
}) {
  'use no memo';
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

  const transform = useDerivedValue(() => {
    if (appActive.value === 0) return [{ rotate: 0 }];
    const turns = (clock.value / 1000) * speed;
    return [{ rotate: (turns % 1) * Math.PI * 2 }];
  });

  const cx = width / 2;
  const cy = height / 2;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { width, height }]}
    >
      <Canvas style={{ width, height }}>
        <Group>
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
              c={{ x: cx, y: cy }}
              colors={[
                'transparent',
                'transparent',
                color,
                color,
                'transparent',
              ]}
              transform={transform}
              origin={{ x: cx, y: cy }}
            />
          </RoundedRect>
        </Group>
      </Canvas>
    </View>
  );
}
