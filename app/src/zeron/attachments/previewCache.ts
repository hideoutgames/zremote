// Local file URIs for attachments this phone just sent. The host rewrites
// the transcript to its own absolute path; the cache lets the bubble paint
// the image we already have instead of a path or a pending:// link.

const byPath = new Map<string, string>();

export const rememberAttachmentPreview = (
  path: string,
  localUri: string,
): void => {
  if (path === '' || localUri === '') return;
  byPath.set(path, localUri);
};

export const attachmentPreviewUri = (path: string): string | undefined =>
  byPath.get(path);

export const resetAttachmentPreviews = (): void => {
  byPath.clear();
};
