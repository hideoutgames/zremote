import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import { GlassControl } from './Glass';
import { Icon } from './Icon';
import { useChromeTheme } from '../chromeTheme';

const SIZE = 38;

// Floating glass chevron that scrolls the conversation to the very bottom.
export function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  const theme = useChromeTheme();
  return (
    <Animated.View
      entering={ZoomIn.duration(160)}
      exiting={ZoomOut.duration(140)}
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
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
