// Local Voice Model session: capture → transcribe → optional cleanup.
// Dictation stays on its own 2s cooldown path in Composer.

import { DEFAULT_CLEANUP_PROMPT } from './prompt';
import {
  replaceVoiceRange,
  spliceVoiceText,
  type VoiceInsertionRange,
} from './draftInsert';
import { validateCleanupOutput } from './validator';
import {
  CLEANUP_MAX_INPUT_CHARS,
  CLEANUP_WATCHDOG_MS,
  transcriptionWatchdogMs,
  type CleanupEngine,
  type TranscriptionEngine,
  type VoiceCapturePort,
  type VoiceNotice,
  type VoicePipelineStage,
} from './types';

export interface LocalVoiceHost {
  chatId: string;
  getDraft(): string;
  setDraft(text: string): void;
  getSelection(): number;
  capture: VoiceCapturePort;
  transcription: TranscriptionEngine;
  cleanup?: CleanupEngine;
  transcriptionPath: string;
  cleanupPath?: string;
  cleanupPrompt?: string;
  onStage(stage: VoicePipelineStage): void;
  onNotice(notice: VoiceNotice | null): void;
  deleteAudio?(uri: string): Promise<void>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

const noSpeech = (text: string): boolean => text.trim().length === 0;

export class LocalVoiceSession {
  private host: LocalVoiceHost;
  private gen = 0;
  private stage: VoicePipelineStage = 'idle';
  private audioUri: string | undefined;
  private durationMs = 0;
  private caret = 0;
  private insertion: VoiceInsertionRange | undefined;
  private watchdog: unknown;
  private recordingId = '';
  private abortWaiters: Array<(err: Error) => void> = [];

  constructor(host: LocalVoiceHost) {
    this.host = host;
  }

  currentStage(): VoicePipelineStage {
    return this.stage;
  }

  currentInsertion(): VoiceInsertionRange | undefined {
    return this.insertion;
  }

  updateHost(patch: Partial<LocalVoiceHost>): void {
    this.host = { ...this.host, ...patch };
  }

  invalidate(): void {
    this.bump();
    this.stage = 'idle';
    this.host.onStage('idle');
    this.host.capture.cancel().catch(() => {});
    this.scrubAudio().catch(() => {});
    this.host.transcription.abort().catch(() => {});
    this.host.cleanup?.abort().catch(() => {});
  }

  async start(): Promise<'ok' | 'missingModel'> {
    if (this.stage !== 'idle') return 'ok';
    if (this.host.transcriptionPath === '') return 'missingModel';
    const mine = this.begin('preparing');
    this.insertion = undefined;
    this.caret = this.host.getSelection();
    this.host.onNotice(null);
    try {
      await this.host.capture.start();
      if (!this.alive(mine)) {
        await this.host.capture.cancel().catch(() => {});
        return 'ok';
      }
      this.setStage('recording');
      return 'ok';
    } catch {
      this.finishIdle();
      return 'ok';
    }
  }

  async stop(): Promise<void> {
    if (this.stage !== 'recording') return;
    const mine = this.gen;
    this.setStage('transcribing');
    try {
      const captured = await this.host.capture.stop();
      if (!this.alive(mine)) {
        await this.dropUri(captured.uri);
        return;
      }
      this.audioUri = captured.uri;
      this.durationMs = captured.durationMs;
      await this.transcribe(mine);
    } catch {
      if (this.alive(mine)) {
        this.host.onNotice({ kind: 'transcribeFailed' });
        this.finishIdle();
      }
    }
  }

  async cancelRecording(): Promise<void> {
    if (this.stage !== 'recording' && this.stage !== 'preparing') return;
    this.invalidate();
    await this.host.capture.cancel().catch(() => {});
  }

  async cancelProcessing(): Promise<void> {
    if (this.stage !== 'transcribing' && this.stage !== 'cleaning') return;
    const keepRaw = this.insertion !== undefined;
    this.bump();
    await this.host.transcription.abort().catch(() => {});
    await this.host.cleanup?.abort().catch(() => {});
    await this.scrubAudio();
    this.stage = 'idle';
    this.host.onStage('idle');
    if (!keepRaw) this.insertion = undefined;
  }

  private async transcribe(mine: number): Promise<void> {
    this.armWatchdog(mine, transcriptionWatchdogMs(this.durationMs));
    let result: { text: string };
    try {
      result = await Promise.race([
        this.host.transcription.transcribe(
          this.audioUri ?? '',
          this.host.transcriptionPath,
        ),
        this.abortGate(),
      ]);
    } catch {
      if (!this.alive(mine)) return;
      this.host.onNotice({ kind: 'transcribeFailed' });
      this.finishIdle();
      return;
    }
    if (!this.alive(mine)) return;
    this.clearWatchdog();
    await this.host.transcription.unload().catch(() => {});
    if (noSpeech(result.text)) {
      this.finishIdle();
      return;
    }
    const { text, range } = spliceVoiceText(
      this.host.getDraft(),
      this.caret,
      result.text,
    );
    this.host.setDraft(text);
    this.insertion = range;
    const cleanupPath = this.host.cleanupPath;
    if (
      this.host.cleanup === undefined ||
      cleanupPath === undefined ||
      cleanupPath === ''
    ) {
      this.finishIdle();
      return;
    }
    if (result.text.length > CLEANUP_MAX_INPUT_CHARS) {
      this.finishIdle();
      return;
    }
    this.setStage('cleaning');
    await this.clean(mine, result.text, cleanupPath);
  }

  private async clean(
    mine: number,
    raw: string,
    cleanupPath: string,
  ): Promise<void> {
    this.armWatchdog(mine, CLEANUP_WATCHDOG_MS);
    let out: { text: string; truncated?: boolean };
    try {
      out = await Promise.race([
        this.host.cleanup!.clean({
          transcript: raw,
          systemPrompt:
            this.host.cleanupPrompt === undefined ||
            this.host.cleanupPrompt.trim() === ''
              ? DEFAULT_CLEANUP_PROMPT
              : this.host.cleanupPrompt,
          modelPath: cleanupPath,
        }),
        this.abortGate(),
      ]);
    } catch {
      if (!this.alive(mine)) return;
      this.host.onNotice({ kind: 'cleanupFailed', raw });
      this.finishIdle();
      return;
    }
    if (!this.alive(mine)) return;
    this.clearWatchdog();
    await this.host.cleanup?.unload().catch(() => {});
    const checked = validateCleanupOutput(raw, out.text, {
      truncated: out.truncated,
    });
    if (!checked.ok) {
      this.host.onNotice({ kind: 'cleanupFailed', raw });
      this.finishIdle();
      return;
    }
    const range = this.insertion;
    if (range === undefined) {
      this.finishIdle();
      return;
    }
    const replaced = replaceVoiceRange(
      this.host.getDraft(),
      range,
      checked.text,
    );
    if (replaced === undefined) {
      this.finishIdle();
      return;
    }
    this.host.setDraft(replaced);
    this.host.onNotice({
      kind: 'restore',
      raw,
      cleaned: checked.text,
      start: range.start,
      end: range.start + checked.text.length,
    });
    this.insertion = {
      start: range.start,
      end: range.start + checked.text.length,
      raw: checked.text,
    };
    this.finishIdle();
  }

  private begin(stage: VoicePipelineStage): number {
    this.gen += 1;
    this.recordingId = `v-${this.gen}`;
    this.setStage(stage);
    return this.gen;
  }

  private bump(): void {
    this.gen += 1;
    this.clearWatchdog();
    const err = new Error('aborted');
    const waiters = this.abortWaiters;
    this.abortWaiters = [];
    for (const reject of waiters) reject(err);
  }

  private abortGate(): Promise<never> {
    return new Promise((_, reject) => {
      this.abortWaiters.push(reject);
    });
  }

  private setStage(stage: VoicePipelineStage): void {
    this.stage = stage;
    this.host.onStage(stage);
  }

  private alive(mine: number): boolean {
    return this.gen === mine && this.host.chatId.length > 0;
  }

  private finishIdle(): void {
    this.clearWatchdog();
    this.stage = 'idle';
    this.host.onStage('idle');
    this.scrubAudio().catch(() => {});
  }

  private armWatchdog(mine: number, ms: number): void {
    this.clearWatchdog();
    const set = this.host.setTimeout ?? setTimeout;
    this.watchdog = set(() => {
      if (!this.alive(mine)) return;
      if (this.stage === 'cleaning') {
        this.host.onNotice({
          kind: 'cleanupFailed',
          raw: this.insertion?.raw,
        });
      } else if (
        this.stage === 'transcribing' &&
        this.insertion === undefined
      ) {
        this.host.onNotice({ kind: 'transcribeFailed' });
      }
      this.bump();
      this.host.transcription.abort().catch(() => {});
      this.host.cleanup?.abort().catch(() => {});
      this.finishIdle();
    }, ms);
  }

  private clearWatchdog(): void {
    if (this.watchdog === undefined) return;
    const clear = this.host.clearTimeout ?? clearTimeout;
    clear(this.watchdog as ReturnType<typeof setTimeout>);
    this.watchdog = undefined;
  }

  private async scrubAudio(): Promise<void> {
    const uri = this.audioUri;
    this.audioUri = undefined;
    if (uri !== undefined) await this.dropUri(uri);
  }

  private async dropUri(uri: string): Promise<void> {
    await this.host.deleteAudio?.(uri).catch(() => {});
  }
}
