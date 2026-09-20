// whisper.rn adapter — on-device whisper.cpp transcription for the Local
// Voice Model pipeline. One WhisperContext is kept per model path and
// released on `unload()` so the pipeline can free ~80–150MB between runs.

import { initWhisper, type WhisperContext } from 'whisper.rn';
import type { TranscriptionEngine, TranscriptionResult } from '../voice/types';

const toFsPath = (uri: string): string =>
  uri.startsWith('file://') ? uri.slice('file://'.length) : uri;

export const createTranscriptionEngine = (): TranscriptionEngine => {
  let context: WhisperContext | undefined;
  let contextPath = '';
  let loading: Promise<WhisperContext> | undefined;
  let activeStop: (() => Promise<void>) | undefined;

  const getContext = (modelPath: string): Promise<WhisperContext> => {
    if (context !== undefined && contextPath === modelPath) {
      return Promise.resolve(context);
    }
    if (loading !== undefined) return loading;
    loading = initWhisper({
      filePath: toFsPath(modelPath),
      useGpu: true,
    }).then(ctx => {
      context = ctx;
      contextPath = modelPath;
      loading = undefined;
      return ctx;
    });
    return loading.catch(err => {
      loading = undefined;
      throw err;
    });
  };

  return {
    isAvailable: () => Promise.resolve(true),
    async transcribe(uri, modelPath) {
      const ctx = await getContext(modelPath);
      const { stop, promise } = ctx.transcribe(toFsPath(uri), {
        language: 'auto',
        maxThreads: 4,
      });
      activeStop = stop;
      try {
        const result = await promise;
        const out: TranscriptionResult = {
          text: result.result.trim(),
          language: result.language,
        };
        return out;
      } finally {
        activeStop = undefined;
      }
    },
    async unload() {
      const ctx = context;
      context = undefined;
      contextPath = '';
      await ctx?.release().catch(() => {});
    },
    async abort() {
      await activeStop?.().catch(() => {});
    },
  };
};
