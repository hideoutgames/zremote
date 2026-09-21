// expo-audio voice capture — records 16kHz mono 16-bit WAV (the only
// container whisper.rn's `transcribe` parses), then releases the mic.

import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';
// `AudioRecorder` is only exposed as a class on the native module object;
// the public API is the `useAudioRecorder` hook, which the voice pipeline's
// imperative port cannot use.
import AudioModule from 'expo-audio/build/AudioModule';
import type { VoiceCapturePort, VoiceCaptureResult } from '../voice/types';

const RECORDING_OPTIONS = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 512000,
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.MAX,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
} as const;

export const createVoiceCapture = (): VoiceCapturePort => {
  let recorder: InstanceType<typeof AudioModule.AudioRecorder> | undefined;
  let startedAt = 0;

  return {
    async start() {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) throw new Error('microphone permission denied');
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      const next = new AudioModule.AudioRecorder(RECORDING_OPTIONS);
      await next.prepareToRecordAsync();
      next.record();
      recorder = next;
      startedAt = Date.now();
    },
    async stop(): Promise<VoiceCaptureResult> {
      const current = recorder;
      recorder = undefined;
      if (current === undefined) throw new Error('not recording');
      await current.stop();
      await setAudioModeAsync({ allowsRecording: false });
      await setIsAudioActiveAsync(false).catch(() => {});
      const uri = current.uri;
      if (uri == null) throw new Error('recording produced no file');
      return { uri, durationMs: Math.max(0, Date.now() - startedAt) };
    },
    async cancel() {
      const current = recorder;
      recorder = undefined;
      if (current === undefined) return;
      await current.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      await setIsAudioActiveAsync(false).catch(() => {});
      const uri = current.uri;
      if (uri != null) {
        const { File } = await import('expo-file-system');
        const f = new File(uri);
        if (f.exists) f.delete();
      }
    },
  };
};
