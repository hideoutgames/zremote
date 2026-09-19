// EffortSlider — Cherry Studio geometry/interaction (capsule, magnetism,
// 200ms snap, haptic on every crossed detent), reimplemented. Outer chrome
// is supplied by EffortOverlay (Liquid Glass).

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { selectionTick } from '../zeron/native/haptics';
import { detentForValue } from './modelPicker';
import {
  effortSliderMagnetRadius,
  effortSliderProgressHeight,
  effortSliderSnapMs,
  effortSliderThumbInset,
  effortSliderThumbSize,
  effortSliderTickSize,
  effortSliderTrackHeight,
  getEffortSliderTrackGeometry,
  magnetize,
  nearestStopIndex,
  stopFraction,
  trackXToFraction,
} from './effortSliderMath';
import { useTheme } from '../theme';

export interface EffortSliderProps {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
}

export function EffortSlider({ levels, value, onChange }: EffortSliderProps) {
  'use no memo';
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const trackWidth = useRef(0);
  const [measured, setMeasured] = useState(0);
  const current = detentForValue(levels, value);
  const currentRef = useRef(current);
  currentRef.current = current;
  const position = useSharedValue(stopFraction(current, levels.length));
  const pressed = useRef(false);

  const commitIndex = useCallback(
    (index: number) => {
      if (index !== currentRef.current && levels[index] !== undefined) {
        selectionTick();
        onChange(levels[index]);
      }
    },
    [levels, onChange],
  );

  const applyX = useCallback(
    (x: number, release: boolean) => {
      const width = trackWidth.current;
      const inset = effortSliderThumbInset + effortSliderThumbSize / 2;
      const raw = trackXToFraction(x, width, inset);
      const pulled = magnetize(raw, levels.length, effortSliderMagnetRadius);
      const next = nearestStopIndex(release ? pulled : raw, levels.length);
      if (release) {
        position.value = reduceMotion
          ? stopFraction(next, levels.length)
          : withTiming(stopFraction(next, levels.length), {
              duration: effortSliderSnapMs,
              easing: Easing.out(Easing.cubic),
            });
        commitIndex(next);
        return;
      }
      position.value = pulled;
      if (next !== currentRef.current) commitIndex(next);
    },
    [commitIndex, levels.length, position, reduceMotion],
  );

  const onTouch = useCallback(
    (e: GestureResponderEvent, release: boolean) => {
      applyX(e.nativeEvent.locationX, release);
    },
    [applyX],
  );

  const geo = getEffortSliderTrackGeometry(
    measured,
    levels.length,
    effortSliderThumbSize,
    effortSliderThumbInset,
  );

  const progressInset = geo.thumbCenterStart - effortSliderProgressHeight / 2;
  const travel = geo.travelDistance;

  const fillStyle = useAnimatedStyle(() => ({
    width: effortSliderProgressHeight + travel * position.value,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: effortSliderThumbInset + travel * position.value,
      },
    ],
  }));

  return (
    <View
      style={styles.track}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        trackWidth.current = w;
        setMeasured(cur => (cur === w ? cur : w));
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={e => {
        pressed.current = true;
        onTouch(e, false);
      }}
      onResponderMove={e => onTouch(e, false)}
      onResponderRelease={e => {
        pressed.current = false;
        onTouch(e, true);
      }}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: levels[current] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => {
        const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = Math.min(Math.max(current + dir, 0), levels.length - 1);
        if (next !== current && levels[next] !== undefined) {
          selectionTick();
          onChange(levels[next]);
          position.value = reduceMotion
            ? stopFraction(next, levels.length)
            : withTiming(stopFraction(next, levels.length), {
                duration: effortSliderSnapMs,
                easing: Easing.out(Easing.cubic),
              });
        }
      }}
    >
      {geo.tickCenters.map((cx, i) => (
        <View
          key={`tick-${i}`}
          pointerEvents="none"
          style={[
            styles.tick,
            {
              left: cx - effortSliderTickSize / 2,
              backgroundColor: i <= current ? theme.text : theme.textSecondary,
            },
          ]}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.progress,
          {
            backgroundColor: theme.text,
            left: progressInset,
            top: (effortSliderTrackHeight - effortSliderProgressHeight) / 2,
          },
          fillStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          {
            backgroundColor: theme.sendActive,
            top: (effortSliderTrackHeight - effortSliderThumbSize) / 2,
          },
          thumbStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: effortSliderTrackHeight,
    borderRadius: effortSliderTrackHeight / 2,
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: effortSliderTickSize,
    height: effortSliderTickSize,
    borderRadius: effortSliderTickSize / 2,
    top: (effortSliderTrackHeight - effortSliderTickSize) / 2,
  },
  progress: {
    position: 'absolute',
    height: effortSliderProgressHeight,
    borderRadius: effortSliderProgressHeight / 2,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    width: effortSliderThumbSize,
    height: effortSliderThumbSize,
    borderRadius: effortSliderThumbSize / 2,
    left: 0,
  },
});
