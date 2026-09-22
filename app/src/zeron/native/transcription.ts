// Local transcription engine port. App-owned adapter dispatching on the
// catalog runtime: whisper.rn for Whisper models, react-native-sherpa-onnx
// for Parakeet (NeMo transducer) models.

import type { TranscriptionEngine, VoiceModelRuntime } from '../voice/types';

export const transcriptionUnavailable: TranscriptionEngine = {
  isAvailable: () => Promise.resolve(false),
  transcribe: () => Promise.reject(new Error('transcription unavailable')),
  unload: () => Promise.resolve(),
  abort: () => Promise.resolve(),
};

export const resolveTranscriptionEngine = async (
  runtime: VoiceModelRuntime = 'whisper',
): Promise<TranscriptionEngine> => {
  try {
    const mod = (
      runtime === 'sherpa'
        ? await import('./sherpaTranscriptionNative')
        : await import('./transcriptionNative')
    ) as {
      createTranscriptionEngine?: () => TranscriptionEngine;
    };
    if (mod.createTranscriptionEngine === undefined) {
      return transcriptionUnavailable;
    }
    return mod.createTranscriptionEngine();
  } catch {
    return transcriptionUnavailable;
  }
};
