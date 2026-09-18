// Expo Go preview shim — not used in production builds.
// react-native-nitro-image's `NitroImage {image:{filePath|url}}` → expo-image
// (bundled in Expo Go SDK 57).

import React from 'react';
import { Image } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';

export interface NitroImageProps {
  image?: { filePath?: string; url?: string };
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  recyclingKey?: string;
}

export const NitroImage = ({
  image,
  style,
  resizeMode,
  recyclingKey,
}: NitroImageProps) => (
  <Image
    source={{ uri: image?.filePath ?? image?.url }}
    style={style}
    contentFit={resizeMode}
    recyclingKey={recyclingKey}
  />
);

export default NitroImage;
