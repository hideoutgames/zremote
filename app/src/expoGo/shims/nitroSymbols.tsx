// Expo Go preview shim — not used in production builds.
// react-native-nitro-symbols `SymbolView` → expo-symbols `SymbolView`
// (bundled in Expo Go SDK 57). Props we use: symbolName, tintColor,
// pointSize, style, fallback.

import React from 'react';
import { SymbolView as ExpoSymbolView } from 'expo-symbols';
import type { StyleProp, ViewStyle } from 'react-native';

export interface SymbolViewProps {
  symbolName?: string;
  name?: string;
  tintColor?: string;
  pointSize?: number;
  style?: StyleProp<ViewStyle>;
  fallback?: React.ReactNode;
}

export const SymbolView = ({
  symbolName,
  name,
  tintColor,
  pointSize,
  style,
  fallback,
}: SymbolViewProps) => (
  <ExpoSymbolView
    name={(symbolName ?? name ?? 'questionmark') as never}
    tintColor={tintColor}
    size={pointSize}
    style={style}
    fallback={fallback}
  />
);

export default SymbolView;
