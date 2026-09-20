// Cleanup engine port. App-owned adapter around llama.rn (or a Nitro
// llama.cpp fallback). Transcript is always a separate user payload.

import type { CleanupEngine } from '../voice/types';

export const cleanupUnavailable: CleanupEngine = {
  supportsCustomPrompt: true,
  isAvailable: () => Promise.resolve(false),
  clean: () => Promise.reject(new Error('cleanup unavailable')),
  unload: () => Promise.resolve(),
  abort: () => Promise.resolve(),
};

export const resolveCleanupEngine = async (): Promise<CleanupEngine> => {
  try {
    const mod = (await import('./cleanupNative')) as {
      createCleanupEngine?: () => CleanupEngine;
    };
    if (mod.createCleanupEngine === undefined) return cleanupUnavailable;
    return mod.createCleanupEngine();
  } catch {
    return cleanupUnavailable;
  }
};
