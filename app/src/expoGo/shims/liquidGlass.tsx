// Expo Go preview shim — not used in production builds.
// @callstack/liquid-glass → expo-glass-effect (bundled in Expo Go SDK 57).
// Maps `isLiquidGlassSupported`/`LiquidGlassView` onto GlassView.

import React from 'react';
import {
  GlassContainer,
  GlassView,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

export const isLiquidGlassSupported: boolean = isLiquidGlassAvailable();

export interface LiquidGlassViewProps {
  interactive?: boolean;
  effect?: 'clear' | 'regular';
  colorScheme?: 'light' | 'dark';
  tintColor?: ColorValue;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const LiquidGlassView = ({
  interactive,
  effect,
  colorScheme,
  tintColor,
  style,
  children,
}: LiquidGlassViewProps) => (
  <GlassView
    isInteractive={interactive}
    glassEffectStyle={effect ?? 'regular'}
    colorScheme={colorScheme ?? 'auto'}
    tintColor={tintColor}
    style={style}
  >
    {children}
  </GlassView>
);

export interface LiquidGlassContainerViewProps {
  spacing?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const LiquidGlassContainerView = ({
  spacing,
  style,
  children,
}: LiquidGlassContainerViewProps) => (
  <GlassContainer spacing={spacing} style={style}>
    {children}
  </GlassContainer>
);

export default LiquidGlassView;
