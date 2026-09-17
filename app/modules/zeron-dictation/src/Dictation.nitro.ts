// Dictation — Nitro spec for the on-device speech module (iOS only).
// Matches src/zeron/native/dictation.ts DictationPort plus model download.

import type { HybridObject } from 'react-native-nitro-modules';

export type DictationModelState =
  | 'installed'
  | 'downloadable'
  | 'downloading'
  | 'unsupported';

export type DictationSupport = {
  supported: boolean;
  onDevice: boolean;
  reason?: string;
};

export interface Dictation extends HybridObject<{ ios: 'swift' }> {
  isSupported(): Promise<DictationSupport>;
  modelState(locale: string): Promise<DictationModelState>;
  downloadModel(
    locale: string,
    onProgress: (progress: number) => void,
  ): Promise<void>;
  start(
    locale: string | undefined,
    onPartial: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (message: string) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
}
