// EffortSlider — discrete detents over the harness's advertised reasoning
// levels (modelPicker.ts helpers drive the math; expo-haptics ticks when a
// drag crosses a detent; accessibilityRole="adjustable" with
// increment/decrement).

import React, { useCallback, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme';
import { detentForValue, nearestDetent } from './modelPicker';

export interface EffortSliderProps {
  levels: readonly string[];
  value: string | undefined;
  onChange: (level: string) => void;
}

const capitalize = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);

export function EffortSlider({ levels, value, onChange }: EffortSliderProps) {
  const theme = useTheme();
  const trackWidth = useRef(0);
  const current = detentForValue(levels, value);

  const moveTo = useCallback(
    (x: number) => {
      const next = nearestDetent(x, trackWidth.current, levels.length);
      if (next !== current && levels[next] !== undefined) {
        Haptics.selectionAsync().catch(() => {});
        onChange(levels[next]);
      }
    },
    [current, levels, onChange],
  );

  const onTouch = useCallback(
    (e: GestureResponderEvent) => moveTo(e.nativeEvent.locationX),
    [moveTo],
  );

  return (
    <View style={styles.wrap}>
      <Text style={[styles.value, { color: theme.text }]}>
        {capitalize(levels[current] ?? '')}
      </Text>
      <View
        style={[styles.track, { backgroundColor: theme.border }]}
        onLayout={e => (trackWidth.current = e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: levels[current] }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => {
          const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          const next = Math.min(Math.max(current + dir, 0), levels.length - 1);
          if (next !== current && levels[next] !== undefined)
            onChange(levels[next]);
        }}
      >
        {levels.map((l, i) => (
          <Pressable
            key={l}
            style={[
              styles.detent,
              {
                backgroundColor:
                  i === current ? theme.accent : theme.textSecondary,
              },
            ]}
            onPress={() => {
              if (i !== current) {
                Haptics.selectionAsync().catch(() => {});
                onChange(l);
              }
            }}
          />
        ))}
      </View>
      <View style={styles.labels}>
        {levels.map(l => (
          <Text
            key={l}
            style={[styles.label, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {capitalize(l)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  value: { fontSize: 20, fontWeight: '600' },
  track: {
    height: 4,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
  },
  detent: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 11 },
});
