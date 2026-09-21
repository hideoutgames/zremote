import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { GlassControl } from './Glass';
import { Icon } from './Icon';
import { useChromeTheme } from '../chromeTheme';

export const SCROLL_TO_BOTTOM_SIZE = 38;

// Floating glass chevron that scrolls the conversation to the very bottom.
export function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  const theme = useChromeTheme();
  return (
    <Animated.View
      entering={FadeInUp.duration(160)}
      exiting={FadeOutDown.duration(140)}
    >
      <GlassControl
        interactive
        onPress={onPress}
        hitSlop={10}
        style={styles.circle}
        accessibilityRole="button"
      >
        <Icon name="chevron.down" size={18} color={theme.text} />
      </GlassControl>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: SCROLL_TO_BOTTOM_SIZE,
    height: SCROLL_TO_BOTTOM_SIZE,
    borderRadius: SCROLL_TO_BOTTOM_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
