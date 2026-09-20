import { useEffect, useState } from 'react';
import { File } from 'expo-file-system';
import { resolveVoiceCapture } from '../zeron/native/voiceCapture';
import { resolveTranscriptionEngine } from '../zeron/native/transcription';
import { resolveCleanupEngine } from '../zeron/native/cleanup';
import { getVoiceModelManager, type LocalVoiceRuntime } from '../zeron/voice';
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
  const [runtime, setRuntime] = useState<LocalVoiceRuntime | undefined>(
    undefined,
  );

  useEffect(() => {
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
        resolveTranscriptionEngine(),
        resolveCleanupEngine(),
      ]);
      if (!mounted) return;
      setRuntime({
        capture,
        transcription,
        cleanup: cleanupPath ? cleanup : undefined,
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
  }, [enabled, voiceModelId, cleanupModelId]);

  return runtime;
};
