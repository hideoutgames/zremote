// Attachment staging validation — the rules behind
// apps/ios/Zeron/Composer/Attachments.swift `StagedAttachment.stage` and the
// host's upload path (crates/engine/src/uploads.rs).
//
// Upload/commit stores any bytes under the size cap; host `ReadAttachmentChunk`
// still only serves image types (`mime_by_ext`). Composer preview is local
// (device URI), and the agent opens committed filesystem paths from the
// prompt trailer, so documents (text/pdf/json/…) are legal to stage and send.

/** use-attachments.ts / Attachments.swift `maxAttachmentBytes`. */
export const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

/** crates/engine/src/uploads.rs `mime_by_ext` — what the host will serve
 * back to clients via `ReadAttachmentChunk`. Composer preview does not
 * use this path (local URIs stay on device). */
export const HOST_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
]);

/** Files entry point: the system document picker, not an image-only filter.
 * Photos/camera stay on the dedicated image pickers. */
export const FILE_PICKER_MIME = '*/*';

export type ValidationResult = { ok: true } | { ok: false; reason: 'tooLarge' };

export const isImageMime = (mimeType: string): boolean =>
  mimeType.toLowerCase().startsWith('image/');

export const validateStagedAttachment = (a: {
  name: string;
  mimeType: string;
  size: number;
}): ValidationResult => {
  if (a.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true };
};

/** True when the run request can carry `attachments` inline for this
 * harness — only claude (base64 image blocks, claude/mod.rs L470) and
 * opencode (`{type:'file', url:'file://…'}` parts, opencode/mod.rs L1829)
 * read the field; every other harness sees the prompt-trailer paths only
 * (which is exactly desktop's degradation). Non-image files are never
 * inlined — those harnesses expect image blocks. */
export const harnessInlinesAttachments = (harnessId: string): boolean =>
  harnessId === 'claude' ||
  harnessId === 'claude-code' ||
  harnessId === 'opencode';
