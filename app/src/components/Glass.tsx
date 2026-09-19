import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  type ColorValue,
  type PressableProps,
  type ViewProps,
} from 'react-native';
import { BlurView } from 'expo-blur';
import {
  isLiquidGlassSupported,
  LiquidGlassContainerView,
  LiquidGlassView,
} from '@callstack/liquid-glass';
import { useTheme } from '../theme';

type GlassProps = ViewProps & {
  // Interactive glass grows on touch and shimmers (iOS 26+ only).
  interactive?: boolean;
  // Base tint of the glass; lifts it off pure black when there is little
  // content behind it to frost.
  tintColor?: ColorValue;
  // Animate materialize/dematerialize of the glass effect (iOS 26+).
  animated?: boolean;
};

// Real liquid glass on iOS 26+, a plain rounded surface everywhere else.
export function Glass({
  interactive,
  tintColor,
  animated,
  style,
  children,
  ...rest
}: GlassProps) {
  const theme = useTheme();
  // Reduce Transparency → always the opaque fallback surface.
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(setReduceTransparency)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => sub.remove();
  }, []);
  if (isLiquidGlassSupported && !reduceTransparency) {
    return (
      <LiquidGlassView
        interactive={interactive}
        effect="regular"
        animated={animated}
        colorScheme={theme.scheme}
        tintColor={tintColor}
        style={style}
        {...rest}
      >
        {children}
      </LiquidGlassView>
    );
  }

  // Standard material fallback (iOS < 26): BlurView, not a flat fill.
  if (!reduceTransparency) {
    return (
      <View
        style={[styles.clip, { borderColor: theme.border }, style]}
        {...rest}
      >
        <BlurView
          tint={
            theme.scheme === 'dark'
              ? 'systemThinMaterialDark'
              : 'systemThinMaterialLight'
          }
          intensity={60}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        {
          backgroundColor: tintColor ?? theme.glassFallbackBackground,
          borderColor: theme.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

type GlassContainerProps = ViewProps & {
  // Distance at which adjacent glass elements start merging (pt).
  spacing?: number;
};

// Clusters adjacent glass controls so the system merges them; plain layout
// where glass is unsupported.
export function GlassContainer({
  spacing,
  style,
  children,
  ...rest
}: GlassContainerProps) {
  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassContainerView spacing={spacing} style={style} {...rest}>
        {children}
      </LiquidGlassContainerView>
    );
  }
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}

type GlassControlProps = ViewProps &
  Pick<
    PressableProps,
    | 'onPress'
    | 'disabled'
    | 'hitSlop'
    | 'testID'
    | 'accessibilityRole'
    | 'accessibilityLabel'
    | 'accessibilityState'
    | 'accessibilityHint'
  > & {
    interactive?: boolean;
    tintColor?: ColorValue;
  };

// Interactive glass as the outer surface; the Pressable lives *inside* so
// iOS 26 does not wrap a second glass UIButton around the chip.
export function GlassControl({
  interactive = true,
  tintColor,
  style,
  children,
  onPress,
  disabled,
  hitSlop,
  testID,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  accessibilityHint,
  ...rest
}: GlassControlProps) {
  return (
    <Glass
      interactive={interactive}
      tintColor={tintColor}
      style={style}
      {...rest}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        hitSlop={hitSlop}
        testID={testID}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        accessibilityHint={accessibilityHint}
        style={styles.controlHit}
      >
        {children}
      </Pressable>
    </Glass>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  controlHit: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
