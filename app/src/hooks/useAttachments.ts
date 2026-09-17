// Composer attachment staging: photos land in draftStore as 'staged'
// StagedAttachments (local-only this stage — upload ships next).

import { useCallback } from 'react';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  stageAttachment,
  removeAttachment,
  type StagedAttachment,
} from '../zeron/state/draftStore';

export function useAttachments(chatId: string): {
  pickImages: () => Promise<void>;
  remove: (id: string) => void;
} {
  const pickImages = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: false,
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 0.9,
      selectionLimit: 4,
    });
    if (result.didCancel || !result.assets) return;
    for (const asset of result.assets) {
      if (asset.uri === undefined) continue;
      const a: Omit<StagedAttachment, 'id' | 'uploadState'> = {
        kind: 'image',
        name: asset.fileName ?? 'photo',
        mimeType: asset.type ?? 'image/jpeg',
        size: asset.fileSize ?? 0,
        localUri: asset.uri,
      };
      stageAttachment(chatId, a);
    }
  }, [chatId]);

  const remove = useCallback(
    (id: string) => removeAttachment(chatId, id),
    [chatId],
  );

  return { pickImages, remove };
}
