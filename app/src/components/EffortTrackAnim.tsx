import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import {
  effortSliderProgressHeight,
  effortSliderThumbInset,
  effortSliderThumbSize,
  effortSliderTrackHeight,
} from './effortSliderMath';

export function EffortTrackAnim({
  travel,
  position,
  progressInset,
  fillColor,
  thumbColor,
}: {
  travel: number;
  position: SharedValue<number>;
  progressInset: number;
  fillColor: string;
  thumbColor: string;
}) {
  'use no memo';
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
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.progress,
          {
            backgroundColor: fillColor,
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
            backgroundColor: thumbColor,
            top: (effortSliderTrackHeight - effortSliderThumbSize) / 2,
          },
          thumbStyle,
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
