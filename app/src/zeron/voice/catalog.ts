// Pinned local-model catalog. Artifacts are sha256-verified after download;
// update `bytes` and `sha256` together when bumping a revision.

import type { VoiceModelCatalogEntry } from './types';

export const WHISPER_TINY_ID = 'whisper-tiny';
export const WHISPER_BASE_ID = 'whisper-base';
export const PARAKEET_V2_ID = 'parakeet-tdt-0.6b-v2';
export const PARAKEET_V3_ID = 'parakeet-tdt-0.6b-v3';
export const CLEANUP_QWEN_ID = 'qwen25-0.5b-instruct';
export const CLEANUP_SMOLLM2_135M_ID = 'smollm2-135m-instruct';
export const CLEANUP_SMOLLM2_360M_ID = 'smollm2-360m-instruct';

const HF = 'https://huggingface.co';
const SHERPA_V2_DIR = `${HF}/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main`;
const SHERPA_V3_DIR = `${HF}/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main`;

export const VOICE_MODEL_CATALOG: readonly VoiceModelCatalogEntry[] = [
  {
    id: WHISPER_TINY_ID,
    kind: 'transcription',
    name: 'Whisper Tiny',
    description:
      'Small multilingual transcription model for constrained devices.',
    revision: 'whisper.cpp-ggml-tiny',
    bytes: 77_691_713,
    files: [
      {
        name: 'whisper-tiny.bin',
        url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin`,
        bytes: 77_691_713,
        sha256:
          'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
      },
    ],
    license: 'MIT',
    runtime: 'whisper',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: true },
    productionPinned: true,
  },
  {
    id: WHISPER_BASE_ID,
    kind: 'transcription',
    name: 'Whisper Base',
    description:
      'Larger multilingual transcription model for better recognition.',
    revision: 'whisper.cpp-ggml-base',
    bytes: 147_951_465,
    files: [
      {
        name: 'whisper-base.bin',
        url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`,
        bytes: 147_951_465,
        sha256:
          '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
      },
    ],
    license: 'MIT',
    runtime: 'whisper',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: true },
    productionPinned: true,
  },
  {
    id: PARAKEET_V2_ID,
    kind: 'transcription',
    name: 'Parakeet TDT v2',
    description:
      'NVIDIA English transcription (sherpa-onnx int8) — fast on-device.',
    revision: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    bytes: 652_184_296 + 7_257_753 + 1_739_080 + 9_384,
    files: [
      {
        name: 'encoder.int8.onnx',
        url: `${SHERPA_V2_DIR}/encoder.int8.onnx`,
        bytes: 652_184_296,
        sha256:
          'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab',
      },
      {
        name: 'decoder.int8.onnx',
        url: `${SHERPA_V2_DIR}/decoder.int8.onnx`,
        bytes: 7_257_753,
        sha256:
          'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e',
      },
      {
        name: 'joiner.int8.onnx',
        url: `${SHERPA_V2_DIR}/joiner.int8.onnx`,
        bytes: 1_739_080,
        sha256:
          '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2',
      },
      {
        name: 'tokens.txt',
        url: `${SHERPA_V2_DIR}/tokens.txt`,
        bytes: 9_384,
        sha256:
          'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d',
      },
    ],
    license: 'CC-BY-4.0',
    runtime: 'sherpa',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: false },
    productionPinned: true,
  },
  {
    id: PARAKEET_V3_ID,
    kind: 'transcription',
    name: 'Parakeet TDT v3',
    description:
      'NVIDIA multilingual transcription (sherpa-onnx int8, 25 languages).',
    revision: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    bytes: 652_184_281 + 11_845_275 + 6_355_277 + 93_939,
    files: [
      {
        name: 'encoder.int8.onnx',
        url: `${SHERPA_V3_DIR}/encoder.int8.onnx`,
        bytes: 652_184_281,
        sha256:
          'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247',
      },
      {
        name: 'decoder.int8.onnx',
        url: `${SHERPA_V3_DIR}/decoder.int8.onnx`,
        bytes: 11_845_275,
        sha256:
          '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e',
      },
      {
        name: 'joiner.int8.onnx',
        url: `${SHERPA_V3_DIR}/joiner.int8.onnx`,
        bytes: 6_355_277,
        sha256:
          '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3',
      },
      {
        name: 'tokens.txt',
        url: `${SHERPA_V3_DIR}/tokens.txt`,
        bytes: 93_939,
        sha256:
          'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
      },
    ],
    license: 'CC-BY-4.0',
    runtime: 'sherpa',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: false, autoLanguage: true },
    productionPinned: true,
  },
  {
    id: CLEANUP_QWEN_ID,
    kind: 'cleanup',
    name: 'Qwen 0.5B Instruct',
    description: 'Optional on-device cleanup for filler and self-corrections.',
    revision: 'qwen2.5-0.5b-instruct-q4_k_m',
    bytes: 491_400_032,
    files: [
      {
        name: 'qwen25-0.5b-instruct.bin',
        url: `${HF}/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf`,
        bytes: 491_400_032,
        sha256:
          '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
      },
    ],
    license: 'Apache-2.0',
    runtime: 'llama',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: true, autoLanguage: false },
    productionPinned: true,
  },
  {
    id: CLEANUP_SMOLLM2_135M_ID,
    kind: 'cleanup',
    name: 'SmolLM2 135M Instruct',
    description: 'Smallest cleanup option — lowest memory and storage use.',
    revision: 'smollm2-135m-instruct-q4_k_m',
    bytes: 105_454_432,
    files: [
      {
        name: 'smollm2-135m-instruct.bin',
        url: `${HF}/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf`,
        bytes: 105_454_432,
        sha256:
          '2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d',
      },
    ],
    license: 'Apache-2.0',
    runtime: 'llama',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: true, autoLanguage: false },
    productionPinned: true,
  },
  {
    id: CLEANUP_SMOLLM2_360M_ID,
    kind: 'cleanup',
    name: 'SmolLM2 360M Instruct',
    description: 'Compact cleanup model balancing size and rewrite quality.',
    revision: 'smollm2-360m-instruct-q4_k_m',
    bytes: 270_590_880,
    files: [
      {
        name: 'smollm2-360m-instruct.bin',
        url: `${HF}/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf`,
        bytes: 270_590_880,
        sha256:
          '2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2',
      },
    ],
    license: 'Apache-2.0',
    runtime: 'llama',
    requiredRuntimeVersion: '1',
    capabilities: { supportsCustomPrompt: true, autoLanguage: false },
    productionPinned: true,
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
