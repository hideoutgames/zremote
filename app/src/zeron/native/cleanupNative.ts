// llama.rn adapter — on-device llama.cpp cleanup for the Local Voice Model
// pipeline. One LlamaContext per model path, released on `unload()`.

import { initLlama, type LlamaContext } from 'llama.rn';
import type {
  CleanupEngine,
  CleanupRequest,
  CleanupResult,
} from '../voice/types';

const toFsPath = (uri: string): string =>
  uri.startsWith('file://') ? uri.slice('file://'.length) : uri;

const STOP_WORDS = [
  '<|im_end|>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

export const createCleanupEngine = (): CleanupEngine => {
  let context: LlamaContext | undefined;
  let contextPath = '';
  let loading: Promise<LlamaContext> | undefined;

  const getContext = (modelPath: string): Promise<LlamaContext> => {
    if (context !== undefined && contextPath === modelPath) {
      return Promise.resolve(context);
    }
    if (loading !== undefined) return loading;
    // Switching models: drop the resident context first — keeping both
    // alive is what OOMs the init on memory-tight devices.
    const stale = context;
    context = undefined;
    contextPath = '';
    loading = (async () => {
      await stale?.release().catch(() => {});
      return initLlama({
        model: toFsPath(modelPath),
        // Inputs are capped at 4k chars (~1.3k tokens); prompt + rewrite
        // need ~3k — 2048 overflowed into context_full failures.
        n_ctx: 4096,
        n_gpu_layers: 99,
      });
    })().then(
      ctx => {
        context = ctx;
        contextPath = modelPath;
        loading = undefined;
        return ctx;
      },
      err => {
        loading = undefined;
        throw err;
      },
    );
    return loading;
  };

  return {
    supportsCustomPrompt: true,
    isAvailable: () => Promise.resolve(true),
    async clean(req: CleanupRequest): Promise<CleanupResult> {
      const ctx = await getContext(req.modelPath);
      const result = await ctx.completion({
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.transcript },
        ],
        // The rewrite is at most the input length plus whitespace; 1024
        // truncated 4k-char transcripts into stopped_limit failures.
        n_predict: 2048,
        temperature: 0.2,
        stop: STOP_WORDS,
      });
      return {
        text: result.text.trim(),
        truncated:
          result.stopped_limit > 0 ||
          result.context_full ||
          result.truncated ||
          result.interrupted,
      };
    },
    async unload() {
      const ctx = context;
      context = undefined;
      contextPath = '';
      await ctx?.release().catch(() => {});
    },
    async abort() {
      await context?.stopCompletion().catch(() => {});
    },
  };
};
