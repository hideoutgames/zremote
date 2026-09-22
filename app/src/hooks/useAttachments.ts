// Composer attachment staging: photos/camera/files land in draftStore as
// 'staged' StagedAttachments. Validation is shared with the send path
// (attachments/validate) — oversized files are rejected with a reason, never
// silently dropped.

import { useCallback } from 'react';
import { InteractionManager } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import {
  stageAttachments,
  removeAttachment,
  type StageAttachmentInput,
  type StagedAttachment,
} from '../zeron/state/draftStore';
import {
  FILE_PICKER_MIME,
  validateStagedAttachment,
} from '../zeron/attachments/validate';
import { mimeForFileName } from '../zeron/attachments/paste';
import { base64ToBytes } from '../zeron/util/base64';
import { newId } from '../zeron/doc/sessionDoc';

export interface StageResult {
  staged: StagedAttachment[];
  rejected: { name: string; reason: string }[];
}

/** Wait for the Zeego attach menu to finish dismissing before presenting
 * another UIKit controller (UIDocumentPicker / PHPicker). */
export const PICKER_MENU_DELAY_MS = 100;

export const afterAttachMenuDismissed = <T>(
  run: () => Promise<T>,
): Promise<T> =>
  new Promise((resolve, reject) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        run().then(resolve, reject);
      }, PICKER_MENU_DELAY_MS);
    });
  });

const collectAndStage = (
  chatId: string,
  items: StageAttachmentInput[],
): StageResult => {
  const out: StageResult = { staged: [], rejected: [] };
  const accepted: StageAttachmentInput[] = [];
  for (const a of items) {
    const v = validateStagedAttachment(a);
    if (v.ok === false) {
      out.rejected.push({ name: a.name, reason: v.reason });
      continue;
    }
    accepted.push(a);
  }
  if (accepted.length > 0) {
    out.staged.push(...stageAttachments(chatId, accepted));
  }
  return out;
};

export type DocumentPickerAssetLike = {
  name: string;
  uri: string;
  mimeType?: string | null;
  size?: number | null;
};

export const stageDocumentPickerResult = (
  chatId: string,
  result: { canceled: boolean; assets?: DocumentPickerAssetLike[] | null },
): StageResult => {
  if (result.canceled === true || result.assets == null) {
    return { staged: [], rejected: [] };
  }
  return collectAndStage(
    chatId,
    result.assets.map(file => ({
      kind: 'file' as const,
      name: file.name,
      mimeType: file.mimeType ?? 'image/jpeg',
      size: file.size ?? 0,
      localUri: file.uri,
    })),
  );
};

export const pickFilesForChat = async (
  chatId: string,
): Promise<StageResult> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: [FILE_PICKER_MIME],
    multiple: true,
    copyToCacheDirectory: true,
  });
  return stageDocumentPickerResult(chatId, result);
};

/** Pasted content lands in the cache dir as a real file so the staged
 * attachment's `localUri` reads like any other (picker) asset. Names are
 * unique per paste — a second paste never clobbers a still-staged file. */
const writePastedFile = (
  name: string,
  content: string | Uint8Array,
): { uri: string; size: number } => {
  const dir = new Directory(Paths.cache, 'zeron', 'pasted');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, name);
  file.create({ intermediates: true, overwrite: true });
  file.write(content);
  return { uri: file.uri, size: file.size };
};

/** A long text paste staged as `pasted.txt` (paste.ts threshold). */
export const stagePastedText = (chatId: string, text: string): StageResult => {
  const id = newId();
  const { uri, size } = writePastedFile(`pasted-${id}.txt`, text);
  return collectAndStage(chatId, [
    {
      id,
      kind: 'file',
      name: 'pasted.txt',
      mimeType: 'text/plain',
      size,
      localUri: uri,
    },
  ]);
};

/** A clipboard image paste (UIPasteControl / `getImageAsync` base64). */
export const stagePastedImage = (
  chatId: string,
  base64: string,
): StageResult => {
  const id = newId();
  const { uri, size } = writePastedFile(
    `pasted-${id}.png`,
    base64ToBytes(base64),
  );
  return collectAndStage(chatId, [
    {
      id,
      kind: 'image',
      name: 'pasted.png',
      mimeType: 'image/png',
      size,
      localUri: uri,
    },
  ]);
};

/** A copied file pasted as a `file://` URL. Stages nothing when the path
 * isn't readable (other-app sandbox) — the caller falls back to text. */
export const stagePastedFileUri = (
  chatId: string,
  uri: string,
): StageResult => {
  const file = new File(uri);
  if (!file.exists) return { staged: [], rejected: [] };
  return collectAndStage(chatId, [
    {
      kind: 'file',
      name: file.name,
      mimeType: mimeForFileName(file.name),
      size: file.size,
      localUri: file.uri,
    },
  ]);
};

export function useAttachments(chatId: string): {
  pickImages: () => Promise<StageResult>;
  pickCamera: () => Promise<StageResult>;
  pickFiles: () => Promise<StageResult>;
  remove: (id: string) => void;
} {
  const pickImages = useCallback(
    () =>
      afterAttachMenuDismissed(async () => {
        const result = await launchImageLibrary({
          mediaType: 'photo',
          includeBase64: false,
          maxWidth: 2048,
          maxHeight: 2048,
          quality: 0.9,
          selectionLimit: 4,
        });
        if (result.didCancel || !result.assets) {
          return { staged: [], rejected: [] };
        }
        const items: StageAttachmentInput[] = [];
        for (const asset of result.assets) {
          if (asset.uri === undefined) continue;
          items.push({
            kind: 'image',
            name: asset.fileName ?? 'photo',
            mimeType: asset.type ?? 'image/jpeg',
            size: asset.fileSize ?? 0,
            localUri: asset.uri,
          });
        }
        return collectAndStage(chatId, items);
      }),
    [chatId],
  );

  const pickCamera = useCallback(
    () =>
      afterAttachMenuDismissed(async () => {
        const result = await launchCamera({
          mediaType: 'photo',
          includeBase64: false,
          maxWidth: 2048,
          maxHeight: 2048,
          quality: 0.9,
        });
        if (result.didCancel || !result.assets) {
          return { staged: [], rejected: [] };
        }
        const items: StageAttachmentInput[] = [];
        for (const asset of result.assets) {
          if (asset.uri === undefined) continue;
          items.push({
            kind: 'image',
            name: asset.fileName ?? 'photo',
            mimeType: asset.type ?? 'image/jpeg',
            size: asset.fileSize ?? 0,
            localUri: asset.uri,
          });
        }
        return collectAndStage(chatId, items);
      }),
    [chatId],
  );

  // Files picker is unfiltered (`*/*`); shared validation only enforces
  // the 24MB cap. Photos/camera stay on the image pickers.
  const pickFiles = useCallback(
    () => afterAttachMenuDismissed(() => pickFilesForChat(chatId)),
    [chatId],
  );

  const remove = useCallback(
    (id: string) => removeAttachment(chatId, id),
    [chatId],
  );

  return { pickImages, pickCamera, pickFiles, remove };
}
