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
      const cleanupPath =
        cleanupModelId != null
          ? manager?.installedPath(cleanupModelId)
          : undefined;
      if (voiceModelId != null && transcriptionPath !== '') {
        manager?.markInUse(voiceModelId);
      }
      if (cleanupModelId != null && cleanupPath !== undefined) {
        manager?.markInUse(cleanupModelId);
      }
      const [capture, transcription, cleanup] = await Promise.all([
        resolveVoiceCapture(),
        resolveTranscriptionEngine(
          catalogEntry(voiceModelId)?.runtime ?? 'whisper',
        ),
        resolveCleanupEngine(),
      ]);
      if (!mounted) return;
      // A cleanup engine that reports unavailable (native module not
      // linked) fails every cleanup — keep the raw transcript instead.
      const cleanupUsable =
        cleanupPath !== undefined &&
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
      if (cleanupModelId != null) manager?.release(cleanupModelId);
    };
  }, [enabled, voiceModelId, cleanupModelId, installedTick]);

  return runtime;
};
