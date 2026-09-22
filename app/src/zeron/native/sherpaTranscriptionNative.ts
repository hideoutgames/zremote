// react-native-sherpa-onnx adapter — on-device NeMo Parakeet TDT
// transcription for the Local Voice Model pipeline. One SttEngine is kept
// per model dir and destroyed on `unload()` so the pipeline can free the
// recognizer between runs, matching the whisper adapter's lifecycle.

import { createSTT, type SttEngine } from 'react-native-sherpa-onnx/stt';
import type { TranscriptionEngine, TranscriptionResult } from '../voice/types';

const toFsPath = (uri: string): string =>
  uri.startsWith('file://') ? uri.slice('file://'.length) : uri;

export const createTranscriptionEngine = (): TranscriptionEngine => {
  let engine: SttEngine | undefined;
  let enginePath = '';
  let loading: Promise<SttEngine> | undefined;

  const getEngine = (modelPath: string): Promise<SttEngine> => {
    if (engine !== undefined && enginePath === modelPath) {
      return Promise.resolve(engine);
    }
    if (loading !== undefined) return loading;
    loading = createSTT({
      modelPath: { type: 'file', path: toFsPath(modelPath) },
      modelType: 'nemo_transducer',
      preferInt8: true,
      numThreads: 4,
    }).then(stt => {
      engine = stt;
      enginePath = modelPath;
      loading = undefined;
      return stt;
    });
    return loading.catch(err => {
      loading = undefined;
      throw err;
    });
  };

  return {
    isAvailable: () => Promise.resolve(true),
    async transcribe(uri, modelPath) {
      const stt = await getEngine(modelPath);
      const result = await stt.transcribeFile(toFsPath(uri));
      const out: TranscriptionResult = {
        text: result.text.trim(),
        language: result.lang === '' ? 'en' : result.lang,
      };
      return out;
    },
    async unload() {
      const stt = engine;
      engine = undefined;
      enginePath = '';
      await stt?.destroy().catch(() => {});
    },
    async abort() {
      // Offline decode has no cooperative cancel — destroying the engine
      // is the only stop. The pipeline's abort gate already won the race,
      // so a late rejection lands on a dead generation and is ignored.
      const stt = engine;
      engine = undefined;
      enginePath = '';
      await stt?.destroy().catch(() => {});
    },
  };
};
