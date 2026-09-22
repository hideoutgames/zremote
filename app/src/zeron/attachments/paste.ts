// Paste helpers for the composer. The TextInput diff detects a pasted run
// (a single insert past PASTE_FILE_THRESHOLD can only come from the
// pasteboard); the ClipboardPasteButton delivers image/file/text payloads.
// Long text is staged as a .txt attachment instead of flooding the draft.

/** Inserts longer than this stage as `pasted.txt`, not draft text. */
export const PASTE_FILE_THRESHOLD = 2000;

export type TextEditSplit = {
  prefix: string;
  removed: string;
  inserted: string;
  suffix: string;
};

/** Longest common prefix + suffix of `before`/`after` → the edited span —
 * what a single TextInput change inserted and what it replaced. */
export const splitTextEdit = (before: string, after: string): TextEditSplit => {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    prefix: before.slice(0, prefix),
    removed: before.slice(prefix, before.length - suffix),
    inserted: after.slice(prefix, after.length - suffix),
    suffix: before.slice(before.length - suffix),
  };
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  avif: 'image/avif',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  log: 'text/plain',
  csv: 'text/csv',
};

/** mime for a pasted file:// item — the pasteboard carries only a path. */
export const mimeForFileName = (name: string): string =>
  EXT_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ??
  'application/octet-stream';
