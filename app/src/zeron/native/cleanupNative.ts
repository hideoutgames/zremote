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
    loading = initLlama({
      model: toFsPath(modelPath),
      // Cleanup inputs are capped at 4k chars; 2048 tokens of context is
      // enough headroom for prompt + rewrite on a 0.5B model.
      n_ctx: 2048,
      n_gpu_layers: 99,
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
    supportsCustomPrompt: true,
    isAvailable: () => Promise.resolve(true),
    async clean(req: CleanupRequest): Promise<CleanupResult> {
      const ctx = await getContext(req.modelPath);
      const result = await ctx.completion({
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.transcript },
        ],
        n_predict: 1024,
        temperature: 0.2,
        stop: STOP_WORDS,
      });
      return {
        text: result.text.trim(),
        truncated: result.stopped_limit > 0 || result.context_full,
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
