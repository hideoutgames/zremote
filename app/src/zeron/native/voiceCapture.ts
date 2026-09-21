// Voice capture port — record WAV/PCM to a temp file, then release the mic.
// Native adapter is Mac-gated; Jest and Expo Go use the unavailable stub.

import type { VoiceCapturePort } from '../voice/types';

export const voiceCaptureUnavailable: VoiceCapturePort = {
  start: () => Promise.reject(new Error('voice capture unavailable')),
  stop: () => Promise.reject(new Error('voice capture unavailable')),
  cancel: () => Promise.resolve(),
};

export const resolveVoiceCapture = async (): Promise<VoiceCapturePort> => {
  try {
    const mod = (await import('./voiceCaptureNative')) as {
      createVoiceCapture?: () => VoiceCapturePort;
    };
    if (mod.createVoiceCapture === undefined) return voiceCaptureUnavailable;
    return mod.createVoiceCapture();
  } catch {
    return voiceCaptureUnavailable;
  }
};
