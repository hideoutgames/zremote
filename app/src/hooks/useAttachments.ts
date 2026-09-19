// Composer attachment staging: photos/camera/files land in draftStore as
// 'staged' StagedAttachments. Validation is shared with the send path
// (attachments/validate) — oversized files are rejected with a reason, never
// silently dropped.

import { useCallback } from 'react';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  stageAttachment,
  removeAttachment,
  type StagedAttachment,
} from '../zeron/state/draftStore';
import {
  FILE_PICKER_MIME,
  validateStagedAttachment,
} from '../zeron/attachments/validate';

export interface StageResult {
  staged: StagedAttachment[];
  rejected: { name: string; reason: string }[];
}

const stageOne = (
  chatId: string,
  a: Omit<StagedAttachment, 'id' | 'uploadState'>,
  out: StageResult,
): void => {
  const v = validateStagedAttachment(a);
  if (v.ok === false) {
    out.rejected.push({ name: a.name, reason: v.reason });
    return;
  }
  out.staged.push(stageAttachment(chatId, a));
};

export function useAttachments(chatId: string): {
  pickImages: () => Promise<StageResult>;
  pickCamera: () => Promise<StageResult>;
  pickFiles: () => Promise<StageResult>;
  remove: (id: string) => void;
} {
  const pickImages = useCallback(async () => {
    const out: StageResult = { staged: [], rejected: [] };
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: false,
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 0.9,
      selectionLimit: 4,
    });
    if (result.didCancel || !result.assets) return out;
    for (const asset of result.assets) {
      if (asset.uri === undefined) continue;
      stageOne(
        chatId,
        {
          kind: 'image',
          name: asset.fileName ?? 'photo',
          mimeType: asset.type ?? 'image/jpeg',
          size: asset.fileSize ?? 0,
          localUri: asset.uri,
        },
        out,
      );
    }
    return out;
  }, [chatId]);

  const pickCamera = useCallback(async () => {
    const out: StageResult = { staged: [], rejected: [] };
    const result = await launchCamera({
      mediaType: 'photo',
      includeBase64: false,
      maxWidth: 2048,
      maxHeight: 2048,
      quality: 0.9,
    });
    if (result.didCancel || !result.assets) return out;
    for (const asset of result.assets) {
      if (asset.uri === undefined) continue;
      stageOne(
        chatId,
        {
          kind: 'image',
          name: asset.fileName ?? 'photo',
          mimeType: asset.type ?? 'image/jpeg',
          size: asset.fileSize ?? 0,
          localUri: asset.uri,
        },
        out,
      );
    }
    return out;
  }, [chatId]);

  // Files picker is unfiltered (`*/*`); shared validation only enforces
  // the 24MB cap. Photos/camera stay on the image pickers.
  const pickFiles = useCallback(async () => {
    const out: StageResult = { staged: [], rejected: [] };
    const result = await DocumentPicker.getDocumentAsync({
      type: FILE_PICKER_MIME,
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return out;
    for (const file of result.assets) {
      stageOne(
        chatId,
        {
          kind: 'file',
          name: file.name,
          mimeType: file.mimeType ?? 'image/jpeg',
          size: file.size ?? 0,
          localUri: file.uri,
        },
        out,
      );
    }
    return out;
  }, [chatId]);

  const remove = useCallback(
    (id: string) => removeAttachment(chatId, id),
    [chatId],
  );

  return { pickImages, pickCamera, pickFiles, remove };
}
