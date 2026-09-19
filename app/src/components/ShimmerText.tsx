// Status-line pulse. Previously Skia + Reanimated useDerivedValue/vec, which
// RCTFatal-aborted TestFlight when opening a working thread (worklets 0.10.x
// cannot copy SkFont / compiler memo caches). RN Animated has no worklets.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

type FontWeight = '400' | '500' | '600' | '700' | '800';

type ShimmerTextProps = {
  text: string;
  /** Available width to wrap within (px). */
  width: number;
  fontSize?: number;
  fontWeight?: FontWeight;
  /** Dim base color of the glyphs. */
  baseColor?: string;
  /** Bright color of the moving highlight band. */
  highlightColor?: string;
  /** One full left-to-right sweep, in milliseconds. */
  periodMs?: number;
  maxLines?: number;
  /** Horizontal alignment of each line within `width`. Defaults to 'center'. */
  align?: 'left' | 'center';
};

export function ShimmerText({
  text,
  width,
  fontSize = 14,
  fontWeight = '600',
  baseColor = 'rgba(235,235,245,0.45)',
  highlightColor = 'rgba(255,255,255,0.95)',
  periodMs = 1500,
  maxLines = 3,
  align = 'center',
}: ShimmerTextProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    pulse.setValue(0.55);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: periodMs / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, periodMs, reduceMotion]);

  return (
    <Animated.Text
      style={[
        styles.label,
        {
          width,
          fontSize,
          fontWeight,
          color: reduceMotion ? baseColor : highlightColor,
          textAlign: align,
        },
        reduceMotion ? styles.still : { opacity: pulse },
      ]}
      numberOfLines={maxLines}
    >
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  label: {},
  still: { opacity: 1 },
});
