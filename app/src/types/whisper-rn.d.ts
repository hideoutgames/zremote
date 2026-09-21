// whisper.rn ships its real types under `lib/typescript/index.d.ts`, but its
// package `exports` map only covers `./*` — there is no `.` entry, so tsc
// (bundler resolution) cannot see them on `import 'whisper.rn'`. Minimal
// surface declaration for what the app uses.
declare module 'whisper.rn' {
  export interface WhisperTranscribeResult {
    result: string;
    language: string;
    segments: Array<{ text: string; t0: number; t1: number }>;
    isAborted: boolean;
  }

  export interface WhisperTranscribeOptions {
    language?: string;
    translate?: boolean;
    maxThreads?: number;
    maxLen?: number;
    prompt?: string;
    onProgress?: (progress: number) => void;
  }

  export interface WhisperContext {
    transcribe(
      filePathOrBase64: string | number,
      options?: WhisperTranscribeOptions,
    ): { stop: () => Promise<void>; promise: Promise<WhisperTranscribeResult> };
    release(): Promise<void>;
  }

  export function initWhisper(options: {
    filePath: string;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    useFlashAttn?: boolean;
  }): Promise<WhisperContext>;
}
