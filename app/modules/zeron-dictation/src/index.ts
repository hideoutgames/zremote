// `dictationPort` — DictationPort over the Nitro `Dictation` hybrid
// object. Errors arrive as message strings; the port wraps them in Error.

import { NitroModules } from 'react-native-nitro-modules';
import type { Dictation, DictationModelState } from './Dictation.nitro';
import type {
  DictationCallbacks,
  DictationPort,
} from '../../../src/zeron/native/dictation';

const hybrid = (): Dictation =>
  NitroModules.createHybridObject<Dictation>('Dictation');

export type { DictationModelState };

// Every entry is async-wrapped so a missing native module (Metro bundle
// without the pod) rejects instead of throwing synchronously — callers
// probe with isSupported() and fall back to `dictationUnavailable`.
export const dictationPort: DictationPort & {
  modelState(locale: string): Promise<DictationModelState>;
  downloadModel(
    locale: string,
    onProgress: (progress: number) => void,
  ): Promise<void>;
} = {
  isSupported: async () => hybrid().isSupported(),
  modelState: async locale => hybrid().modelState(locale),
  downloadModel: async (locale, onProgress) =>
    hybrid().downloadModel(locale, onProgress),
  start: async (opts, cb: DictationCallbacks) =>
    hybrid().start(opts.locale, cb.onPartial, cb.onFinal, message =>
      cb.onError(new Error(message)),
    ),
  stop: async () => hybrid().stop(),
  cancel: async () => hybrid().cancel(),
};
