// Expo Go preview shim — not used in production builds.
// @expo/ui/swift-ui primitives only render inside the widget/Live Activity
// process, which never runs in Go. Null components keep imports alive.

import React, { type ReactNode } from 'react';
import { View } from 'react-native';

const stub =
  (_name: string) =>
  ({ children }: { children?: ReactNode }) =>
    <View>{children}</View>;

export const HStack = stub('HStack');
export const VStack = stub('VStack');
export const ZStack = stub('ZStack');
export const Text = stub('Text');
export const Image = stub('Image');
export const Spacer = stub('Spacer');
export const ProgressView = stub('ProgressView');
export const Button = stub('Button');
export const Label = stub('Label');

export default {};
