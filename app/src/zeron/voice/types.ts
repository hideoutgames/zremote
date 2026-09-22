// Shared types for local Voice Model transcription + optional cleanup.
// Native runtimes sit behind these ports so Jest never loads whisper/llama.

export type VoiceInputMode = 'disabled' | 'dictation' | 'voiceModel';

export const VOICE_INPUT_MODES: readonly VoiceInputMode[] = [
  'dictation',
  'voiceModel',
  'disabled',
];

export const parseVoiceInputMode = (v: unknown): VoiceInputMode | undefined =>
  v === 'disabled' || v === 'dictation' || v === 'voiceModel' ? v : undefined;

export type VoicePipelineStage =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'transcribing'
  | 'cleaning';

export type VoiceModelKind = 'transcription' | 'cleanup';

export type VoiceModelRuntime = 'whisper' | 'llama' | 'sherpa';

/** One pinned artifact of a model. Multi-file engines (sherpa-onnx model
 * directories) list every required file; single-file models list exactly
 * one entry installed as `${id}.bin`. */
export interface VoiceModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

export type VoiceModelInstallState =
  | 'notDownloaded'
  | 'downloading'
  | 'verifying'
  | 'installed'
  | 'failed';

export interface VoiceModelCapabilities {
  supportsCustomPrompt: boolean;
  autoLanguage: boolean;
}

export interface VoiceModelCatalogEntry {
  id: string;
  kind: VoiceModelKind;
  name: string;
  description: string;
  revision: string;
  /** Total install size (sum of files[].bytes) — display + free-space check. */
  bytes: number;
  files: readonly VoiceModelFile[];
  license: string;
  runtime: VoiceModelRuntime;
  requiredRuntimeVersion: string;
  capabilities: VoiceModelCapabilities;
  /** False until a Mac spike pins production artifacts. */
  productionPinned: boolean;
}

export interface VoiceCaptureResult {
  uri: string;
  durationMs: number;
}

export interface VoiceCapturePort {
  start(): Promise<void>;
  stop(): Promise<VoiceCaptureResult>;
  cancel(): Promise<void>;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
}

export interface TranscriptionEngine {
  isAvailable(): Promise<boolean>;
  transcribe(uri: string, modelPath: string): Promise<TranscriptionResult>;
  unload(): Promise<void>;
  abort(): Promise<void>;
}

export interface CleanupRequest {
  transcript: string;
  systemPrompt: string;
  modelPath: string;
}

export interface CleanupResult {
  text: string;
  truncated?: boolean;
}

export interface CleanupEngine {
  readonly supportsCustomPrompt: boolean;
  isAvailable(): Promise<boolean>;
  clean(req: CleanupRequest): Promise<CleanupResult>;
  unload(): Promise<void>;
  abort(): Promise<void>;
}

export interface VoiceNotice {
  kind: 'cleanupFailed' | 'restore' | 'missingModel' | 'transcribeFailed';
  raw?: string;
  cleaned?: string;
  start?: number;
  end?: number;
}

export interface LocalVoiceRuntime {
  capture: VoiceCapturePort;
  transcription: TranscriptionEngine;
  cleanup?: CleanupEngine;
  transcriptionPath: string;
  cleanupPath?: string;
  deleteAudio?: (uri: string) => Promise<void>;
}

export const isVoiceProcessing = (stage: VoicePipelineStage): boolean =>
  stage === 'preparing' || stage === 'transcribing' || stage === 'cleaning';

export const isVoiceBusy = (stage: VoicePipelineStage): boolean =>
  stage !== 'idle';

export const transcriptionWatchdogMs = (durationMs: number): number =>
  Math.max(30_000, 4 * Math.max(0, durationMs));

export const CLEANUP_WATCHDOG_MS = 45_000;

/** Rough token budget for Qwen 0.5B cleanup. Over this, skip cleanup. */
export const CLEANUP_MAX_INPUT_CHARS = 4_000;
