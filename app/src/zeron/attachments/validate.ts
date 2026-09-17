// Attachment staging validation — the rules behind
// apps/ios/Zeron/Composer/Attachments.swift `StagedAttachment.stage` and the
// host's read-back jail (crates/engine/src/uploads.rs `mime_by_ext`).
//
// The transport is image-only end to end: the prompt trailer says "Attached
// images", the engine's read-back serves only image mime types, and desktop's
// file input is `accept="image/*"`. Non-image files are rejected here with a
// reason rather than filtered silently.

/** use-attachments.ts / Attachments.swift `maxAttachmentBytes`. */
export const MAX_ATTACHMENT_BYTES = 24 * 1024 * 1024;

/** crates/engine/src/uploads.rs `mime_by_ext` — what the host will serve
 * back to clients (and therefore what the agent can open). */
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

/** Picker filter for the Files entry point: images only, matching the
 * desktop `accept="image/*"` input and the host's read-back jail. */
export const FILE_PICKER_MIME = 'image/*';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'tooLarge' | 'notImage' | 'unsupportedMime' };

export const validateStagedAttachment = (a: {
  name: string;
  mimeType: string;
  size: number;
}): ValidationResult => {
  if (a.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'tooLarge' };
  if (!a.mimeType.startsWith('image/'))
    return { ok: false, reason: 'notImage' };
  if (!HOST_IMAGE_MIMES.has(a.mimeType))
    return { ok: false, reason: 'unsupportedMime' };
  return { ok: true };
};

/** True when the run request can carry `attachments` inline for this
 * harness — only claude (base64 image blocks, claude/mod.rs L470) and
 * opencode (`{type:'file', url:'file://…'}` parts, opencode/mod.rs L1829)
 * read the field; every other harness sees the prompt-trailer paths only
 * (which is exactly desktop's degradation). */
export const harnessInlinesAttachments = (harnessId: string): boolean =>
  harnessId === 'claude' ||
  harnessId === 'claude-code' ||
  harnessId === 'opencode';
