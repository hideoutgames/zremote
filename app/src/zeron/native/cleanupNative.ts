// llama.rn adapter — on-device llama.cpp cleanup for the Local Voice Model
// pipeline. One LlamaContext per model path, released on `unload()`.

import { initLlama, type ContextParams, type LlamaContext } from 'llama.rn';
import {
  chooseCleanupText,
  cleanupResultTruncated,
} from '../voice/cleanupOutput';
import type {
  CleanupEngine,
  CleanupRequest,
  CleanupResult,
} from '../voice/types';

const toFsPath = (uri: string): string => {
  let path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it is not percent-encoded.
  }
  return path;
};

const STOP_WORDS = [
  '<|im_end|>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

const contextParams = (
  modelPath: string,
  gpuLayers: number,
): ContextParams => ({
  model: toFsPath(modelPath),
  // Inputs are capped at 4k chars (~1.3k tokens); prompt + rewrite
  // need ~3k — 2048 overflowed into context_full failures. Shifting
  // would drop the tail of the transcript and the edit would delete it.
  n_ctx: 4096,
  n_gpu_layers: gpuLayers,
  ctx_shift: false,
  use_mlock: false,
});

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
      try {
        return await initLlama(contextParams(modelPath, 99));
      } catch (gpuError) {
        // Metal init fails on some devices; CPU still cleans up.
        try {
          return await initLlama(contextParams(modelPath, 0));
        } catch {
          throw gpuError;
        }
      }
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
      // A previous utterance's cache makes the next edit continue that
      // transcript instead of cleaning this one.
      await ctx.clearCache(false).catch(() => {});
      const result = await ctx.completion({
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.transcript },
        ],
        // The model's own chat template. Thinking mode (the llama.rn
        // default) spends the completion on reasoning, which the
        // validator then rejects, so the raw transcript never changes.
        jinja: true,
        enable_thinking: false,
        add_generation_prompt: true,
        temperature: 0,
        penalty_repeat: 1,
        penalty_freq: 0,
        penalty_present: 0,
        // The rewrite is at most the input length plus whitespace; 1024
        // truncated 4k-char transcripts into stopped_limit failures.
        n_predict: 2048,
        stop: STOP_WORDS,
      });
      return {
        text: chooseCleanupText(req.transcript, {
          content: result.content,
          text: result.text,
        }),
        truncated: cleanupResultTruncated(result),
      };
    },
    async unload() {
      const ctx = context;
      context = undefined;
      contextPath = '';
      loading = undefined;
      await ctx?.release().catch(() => {});
    },
    async abort() {
      await context?.stopCompletion().catch(() => {});
    },
  };
};
