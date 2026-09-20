// Pinned local-model catalog. Production URLs/checksums stay unpinned
// (`productionPinned: false`) until a Mac spike measures real artifacts.

import type { VoiceModelCatalogEntry } from './types';

export const WHISPER_TINY_ID = 'whisper-tiny';
export const WHISPER_BASE_ID = 'whisper-base';
export const CLEANUP_QWEN_ID = 'qwen25-0.5b-instruct';

export const VOICE_MODEL_CATALOG: readonly VoiceModelCatalogEntry[] = [
  {
    id: WHISPER_TINY_ID,
    kind: 'transcription',
    name: 'Whisper Tiny',
    description:
      'Small multilingual transcription model for constrained devices.',
    revision: 'whisper.cpp-ggml-tiny',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    bytes: 77_691_713,
    sha256: '',
    license: 'MIT',
    runtime: 'whisper',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: true },
    productionPinned: false,
  },
  {
    id: WHISPER_BASE_ID,
    kind: 'transcription',
    name: 'Whisper Base',
    description:
      'Larger multilingual transcription model for better recognition.',
    revision: 'whisper.cpp-ggml-base',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    bytes: 147_951_465,
    sha256: '',
    license: 'MIT',
    runtime: 'whisper',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: true },
    productionPinned: false,
  },
  {
    id: CLEANUP_QWEN_ID,
    kind: 'cleanup',
    name: 'Qwen 0.5B Instruct',
    description: 'Optional on-device cleanup for filler and self-corrections.',
    revision: 'qwen2.5-0.5b-instruct-q4_k_m',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    bytes: 397_999_000,
    sha256: '',
    license: 'Apache-2.0',
    runtime: 'llama',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: true, autoLanguage: false },
    productionPinned: false,
  },
];

export const transcriptionCatalog = (): VoiceModelCatalogEntry[] =>
  VOICE_MODEL_CATALOG.filter(e => e.kind === 'transcription');

export const cleanupCatalog = (): VoiceModelCatalogEntry[] =>
  VOICE_MODEL_CATALOG.filter(e => e.kind === 'cleanup');

export const catalogEntry = (
  id: string | null | undefined,
): VoiceModelCatalogEntry | undefined =>
  id == null ? undefined : VOICE_MODEL_CATALOG.find(e => e.id === id);

export const formatModelBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
};
