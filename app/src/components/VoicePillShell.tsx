import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import {
  voicePillCoverTranslate,
  VOICE_PILL_OPEN_WIDTH,
  VOICE_PILL_SIZE,
} from './voicePillMath';

export function VoicePillShell({
  open,
  cover,
  slide,
  style,
  panHandlers,
  children,
}: {
  open: SharedValue<number>;
  cover: SharedValue<number>;
  slide: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  panHandlers?: object;
  children: React.ReactNode;
}) {
  'use no memo';
  const pillStyle = useAnimatedStyle(() => {
    const extra = (VOICE_PILL_OPEN_WIDTH - VOICE_PILL_SIZE) * open.value;
    return {
      width: VOICE_PILL_SIZE + extra,
      transform: [
        {
          translateX: voicePillCoverTranslate(
            open.value,
            cover.value,
            slide.value,
          ),
        },
      ],
    };
  });
  return (
    <Animated.View {...panHandlers} style={[style, pillStyle]}>
      {children}
    </Animated.View>
  );
}
