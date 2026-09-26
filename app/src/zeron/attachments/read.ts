// Read a host-staged attachment back for the transcript thumbnail.
// `ReadAttachmentChunk` (uploads.rs): 45KB base64 slices until `done`.

import type { RelayLike } from './upload';

export const MAX_READ_CHUNKS = 1_000;
export const READ_CHUNK_TIMEOUT_MS = 20_000;

export interface AttachmentBytes {
  name: string;
  mimeType: string;
  /** Whole file, base64. */
  base64: string;
}

interface AttachmentChunk {
  name?: string;
  mimeType?: string;
  data?: string;
  nextOffset?: number;
  done?: boolean;
}

/** Pull `path` (a host absolute path) off the device that owns the chat. */
export const readAttachmentBytes = async (
  relay: RelayLike,
  path: string,
): Promise<AttachmentBytes> => {
  let name = '';
  let mimeType = '';
  let base64 = '';
  let offset = 0;
  let done = false;
  for (let i = 0; i < MAX_READ_CHUNKS; i++) {
    const chunk = await relay.call<AttachmentChunk>(
      'ReadAttachmentChunk',
      { path, offset },
      { timeoutMs: READ_CHUNK_TIMEOUT_MS },
    );
    if (typeof chunk.name === 'string') name = chunk.name;
    if (typeof chunk.mimeType === 'string') mimeType = chunk.mimeType;
    if (typeof chunk.data !== 'string')
      throw new Error('attachment chunk missing data');
    base64 += chunk.data;
    done = chunk.done === true;
    if (done) break;
    if (typeof chunk.nextOffset !== 'number' || chunk.nextOffset <= offset)
      throw new Error('attachment read stuck');
    offset = chunk.nextOffset;
  }
  if (!done) throw new Error('attachment read exceeded chunk cap');
  return { name, mimeType, base64 };
};
