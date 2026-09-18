// Discrete effort slider — Cherry Studio two-layer capsule (64dp outer,
// 44dp progress pill, 36dp thumb, 10dp ticks), tap-to-seek, drag magnetism,
// 200ms ease-out snap. Gestures use RN responders + Reanimated (no RNGH).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { selectionTick } from '../zeron/native/haptics';
import { useTheme } from '../theme';
import { detentForValue } from './modelPicker';
import {
  effortSliderMagnetRadius,
  effortSliderProgressHeight,
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

export interface EffortSliderProps {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
  disabled?: boolean;
}

const SNAP = { duration: 200, easing: Easing.out(Easing.cubic) } as const;

export function EffortSlider({
  levels,
  value,
  onChange,
  disabled = false,
}: EffortSliderProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const widthRef = useRef(0);
  const stopCount = levels.length;
  const valueIndex = detentForValue(levels, value);
  const indexRef = useRef(valueIndex);
  indexRef.current = valueIndex;

  const visualScale = 1;
  const thumbCenterInset =
    (effortSliderThumbInset + effortSliderThumbSize / 2) * visualScale;
  const position = useSharedValue(stopFraction(valueIndex, stopCount));
  const pressed = useRef(false);

  useEffect(() => {
    if (pressed.current) return;
    const target = stopFraction(valueIndex, stopCount);
    position.value = reducedMotion ? target : withTiming(target, SNAP);
  }, [position, reducedMotion, stopCount, valueIndex]);

  const commit = useCallback(
    (index: number) => {
      const level = levels[index];
      if (level === undefined || index === indexRef.current) return;
      selectionTick();
      onChange(level);
    },
    [levels, onChange],
  );

  const seek = useCallback(
    (x: number) => {
      if (disabled || stopCount < 2) return;
      const width = Math.max(widthRef.current, 1);
      const raw = trackXToFraction(x, width, thumbCenterInset);
      const snapIndex = nearestStopIndex(raw, stopCount);
      position.value = magnetize(raw, stopCount, effortSliderMagnetRadius);
      commit(snapIndex);
    },
    [commit, disabled, position, stopCount, thumbCenterInset],
  );

  const onGrant = useCallback(
    (e: GestureResponderEvent) => {
      pressed.current = true;
      seek(e.nativeEvent.locationX);
    },
    [seek],
  );
  const onMove = useCallback(
    (e: GestureResponderEvent) => seek(e.nativeEvent.locationX),
    [seek],
  );
  const onRelease = useCallback(() => {
    pressed.current = false;
    const target = nearestStopIndex(position.value, stopCount);
    const targetFrac = stopFraction(target, stopCount);
    position.value = reducedMotion ? targetFrac : withTiming(targetFrac, SNAP);
    commit(target);
  }, [commit, position, reducedMotion, stopCount]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    widthRef.current = width;
    setMeasuredWidth(cur => (cur === width ? cur : width));
  }, []);

  const { thumbCenterStart, tickCenters, travelDistance } =
    getEffortSliderTrackGeometry(
      measuredWidth,
      stopCount,
      effortSliderThumbSize,
      effortSliderThumbInset,
    );
  const progressInset = thumbCenterStart - effortSliderProgressHeight / 2;
  const capsule = theme.scheme === 'dark' ? '#2C2C2E' : '#FFFFFF';
  const fill = theme.text;
  const thumb = theme.scheme === 'dark' ? '#1C1C1E' : '#FFFFFF';
  const tickMuted =
    theme.scheme === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';
  const tickOnFill =
    theme.scheme === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)';

  const fillStyle = useAnimatedStyle(() => ({
    width: effortSliderProgressHeight + travelDistance * position.value,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: effortSliderThumbInset + travelDistance * position.value },
    ],
  }));

  return (
    <View
      style={[
        styles.track,
        { backgroundColor: capsule, opacity: measuredWidth === 0 ? 0 : 1 },
      ]}
      onLayout={onLayout}
      onStartShouldSetResponder={() => !disabled && stopCount >= 2}
      onMoveShouldSetResponder={() => !disabled && stopCount >= 2}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onRelease}
      accessibilityRole="adjustable"
      accessibilityValue={{ text: levels[valueIndex] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => {
        const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = Math.min(Math.max(valueIndex + dir, 0), stopCount - 1);
        if (next !== valueIndex && levels[next] !== undefined)
          onChange(levels[next]);
      }}
    >
      {tickCenters.map((centerX, i) => (
        <View
          key={`tick-${i}`}
          pointerEvents="none"
          style={[
            styles.tick,
            {
              backgroundColor: tickMuted,
              left: centerX - effortSliderTickSize / 2,
            },
          ]}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          {
            backgroundColor: fill,
            left: progressInset,
          },
          fillStyle,
        ]}
      >
        {tickCenters.map((centerX, i) => (
          <View
            key={`fill-tick-${i}`}
            style={[
              styles.fillTick,
              {
                backgroundColor: tickOnFill,
                left: centerX - progressInset - effortSliderTickSize / 2,
              },
            ]}
          />
        ))}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.thumb,
          { backgroundColor: thumb, shadowColor: '#000000' },
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
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    overflow: 'hidden',
    height: effortSliderProgressHeight,
    borderRadius: effortSliderProgressHeight / 2,
    top: (effortSliderTrackHeight - effortSliderProgressHeight) / 2,
  },
  tick: {
    position: 'absolute',
    width: effortSliderTickSize,
    height: effortSliderTickSize,
    borderRadius: effortSliderTickSize / 2,
    top: (effortSliderTrackHeight - effortSliderTickSize) / 2,
  },
  fillTick: {
    position: 'absolute',
    width: effortSliderTickSize,
    height: effortSliderTickSize,
    borderRadius: effortSliderTickSize / 2,
    top: (effortSliderProgressHeight - effortSliderTickSize) / 2,
  },
  thumb: {
    position: 'absolute',
    width: effortSliderThumbSize,
    height: effortSliderThumbSize,
    borderRadius: effortSliderThumbSize / 2,
    top: (effortSliderTrackHeight - effortSliderThumbSize) / 2,
    elevation: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 1.5,
  },
});
