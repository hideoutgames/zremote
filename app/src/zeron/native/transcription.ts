// Local transcription engine port. App-owned adapter around whisper.rn
// (or a Nitro whisper.cpp fallback) after the Mac compile spike.

import type { TranscriptionEngine } from '../voice/types';

export const transcriptionUnavailable: TranscriptionEngine = {
  isAvailable: () => Promise.resolve(false),
  transcribe: () => Promise.reject(new Error('transcription unavailable')),
  unload: () => Promise.resolve(),
  abort: () => Promise.resolve(),
};

export const resolveTranscriptionEngine =
  async (): Promise<TranscriptionEngine> => {
    try {
      const mod = (await import('./transcriptionNative')) as {
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
