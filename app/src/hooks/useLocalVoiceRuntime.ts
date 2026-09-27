import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { File } from 'expo-file-system';
import { resolveVoiceCapture } from '../zeron/native/voiceCapture';
import { resolveTranscriptionEngine } from '../zeron/native/transcription';
import { resolveCleanupEngine } from '../zeron/native/cleanup';
import {
  catalogEntry,
  getVoiceModelManager,
  voiceModelStore,
  type LocalVoiceRuntime,
} from '../zeron/voice';
import { useCleanupModelId, useVoiceModelId } from '../zeron/state/uiPrefs';

const deleteAudio = async (uri: string): Promise<void> => {
  const file = new File(uri);
  if (file.exists) file.delete();
};

export const useLocalVoiceRuntime = (
  enabled: boolean,
): LocalVoiceRuntime | undefined => {
  const voiceModelId = useVoiceModelId();
  const cleanupModelId = useCleanupModelId();
  // Rebuild when a selected model finishes installing — the pref id itself
  // doesn't change on install completion, so without this the runtime keeps
  // reporting missingModel until the user re-selects or restarts the app.
  const installedTick = useStore(
    voiceModelStore,
    s =>
      `${s.byId[voiceModelId ?? '']?.state === 'installed'}:${
        s.byId[cleanupModelId ?? '']?.state === 'installed'
      }`,
  );
  const [runtime, setRuntime] = useState<LocalVoiceRuntime | undefined>(
    undefined,
  );

  useEffect(() => {
    // installedTick is a dep so install completion rebuilds the runtime —
    // read it here so exhaustive-deps doesn't flag it as unnecessary.
    void installedTick;
    if (!enabled) {
      setRuntime(undefined);
      return;
    }
    let mounted = true;
    const manager = getVoiceModelManager();
    const load = async (): Promise<void> => {
      await manager?.waitReady();
      if (!mounted) return;
      const transcriptionPath =
        voiceModelId != null ? manager?.installedPath(voiceModelId) ?? '' : '';
      // Cleanup is optional. No selection, a non-cleanup id, or a model
      // that is not installed yet leaves the raw transcript in place —
      // and does not load llama.rn.
      const cleanupEntry = catalogEntry(cleanupModelId);
      const cleanupId =
        cleanupEntry?.kind === 'cleanup' ? cleanupEntry.id : undefined;
      const cleanupPath =
        cleanupId !== undefined ? manager?.installedPath(cleanupId) : undefined;
      if (voiceModelId != null && transcriptionPath !== '') {
        manager?.markInUse(voiceModelId);
      }
      if (
        cleanupId !== undefined &&
        cleanupPath !== undefined &&
        cleanupPath !== ''
      ) {
        manager?.markInUse(cleanupId);
      }
      const [capture, transcription, cleanup] = await Promise.all([
        resolveVoiceCapture(),
        resolveTranscriptionEngine(
          catalogEntry(voiceModelId)?.runtime ?? 'whisper',
        ),
        cleanupPath !== undefined && cleanupPath !== ''
          ? resolveCleanupEngine()
          : Promise.resolve(undefined),
      ]);
      if (!mounted) return;
      // A cleanup engine that reports unavailable (native module not
      // linked) fails every cleanup — keep the raw transcript instead.
      const cleanupUsable =
        cleanup !== undefined &&
        cleanupPath !== undefined &&
        cleanupPath !== '' &&
        (await cleanup.isAvailable().catch(() => false));
      setRuntime({
        capture,
        transcription,
        cleanup: cleanupUsable ? cleanup : undefined,
        transcriptionPath,
        cleanupPath,
        deleteAudio,
      });
    };
    load().catch(() => {
      if (mounted) setRuntime(undefined);
    });
    return () => {
      mounted = false;
      if (voiceModelId != null) manager?.release(voiceModelId);
      const cleanupEntry = catalogEntry(cleanupModelId);
      if (cleanupEntry?.kind === 'cleanup') manager?.release(cleanupEntry.id);
    };
  }, [enabled, voiceModelId, cleanupModelId, installedTick]);

  return runtime;
};
