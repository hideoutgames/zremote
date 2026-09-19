import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { VOICE_PILL_OPEN_WIDTH, VOICE_PILL_SIZE } from './voicePillMath';

export function VoicePillShell({
  open,
  slide,
  style,
  panHandlers,
  children,
}: {
  open: SharedValue<number>;
  slide: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  panHandlers?: object;
  children: React.ReactNode;
}) {
  'use no memo';
  const pillStyle = useAnimatedStyle(() => ({
    width:
      VOICE_PILL_SIZE + (VOICE_PILL_OPEN_WIDTH - VOICE_PILL_SIZE) * open.value,
    transform: [{ translateX: slide.value }],
  }));
  return (
    <Animated.View {...panHandlers} style={[style, pillStyle]}>
      {children}
    </Animated.View>
  );
}
