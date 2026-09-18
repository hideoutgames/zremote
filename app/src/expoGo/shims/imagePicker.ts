// Expo Go preview shim — not used in production builds.
// react-native-image-picker → expo-image-picker (bundled in Expo Go).
// Maps to the result shape the app reads: {didCancel, assets:[{uri,
// fileName, type, fileSize}]}.

import * as ImagePicker from 'expo-image-picker';

interface PickerOptions {
  mediaType?: string;
  selectionLimit?: number;
}

export interface PickerAsset {
  uri?: string;
  fileName?: string;
  type?: string;
  fileSize?: number;
}

export interface PickerResult {
  didCancel?: boolean;
  assets?: PickerAsset[];
}

const map = (r: ImagePicker.ImagePickerResult): PickerResult => {
  if (r.canceled) return { didCancel: true };
  return {
    assets: r.assets.map(a => ({
      uri: a.uri,
      fileName: a.fileName ?? undefined,
      type: a.mimeType ?? 'image/jpeg',
      fileSize: a.fileSize ?? undefined,
    })),
  };
};

export const launchImageLibrary = async (
  options: PickerOptions = {},
): Promise<PickerResult> =>
  map(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: (options.selectionLimit ?? 1) > 1,
      selectionLimit: options.selectionLimit ?? 0,
      quality: 0.9,
    }),
  );

export const launchCamera = async (
  _options: PickerOptions = {},
): Promise<PickerResult> =>
  map(
    await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    }),
  );
