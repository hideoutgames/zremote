// Device-local new-thread composer background: validate a picker asset,
// copy it into a managed folder, retire the previous managed file after
// the prefs pointer is committed. Pure + injectable fs so Jest does not
// load expo-file-system.

import { MAX_ATTACHMENT_BYTES } from '../attachments/validate';

export type NewThreadBackgroundEffect =
  | 'none'
  | 'dither'
  | 'ascii'
  | 'halftone'
  | 'scanlines';

export const NEW_THREAD_BACKGROUND_EFFECTS: readonly NewThreadBackgroundEffect[] =
  ['none', 'dither', 'ascii', 'halftone', 'scanlines'];

export interface NewThreadComposerBackground {
  uri: string;
  name: string;
}

export type BackgroundInstallReason = 'tooLarge' | 'unsupported' | 'failed';

export type BackgroundInstallResult =
  | { ok: true; background: NewThreadComposerBackground }
  | { ok: false; reason: BackgroundInstallReason };

export interface BackgroundSource {
  uri: string;
  name: string;
  mimeType?: string;
  size: number;
}

export interface BackgroundFs {
  joinManaged(fileName: string): string;
  isManagedUri(uri: string): boolean;
  copyFile(fromUri: string, destUri: string): Promise<void>;
  deleteFile(uri: string): Promise<void>;
  fileExists(uri: string): Promise<boolean>;
}

export const NEW_THREAD_BACKGROUND_DIR = 'new-thread-backgrounds';
export const NEW_THREAD_BACKGROUND_FROSTED_OPACITY = 0.84;

const RASTER_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'avif',
]);

let boundFs: BackgroundFs | undefined;

export const bindBackgroundFs = (fs: BackgroundFs): void => {
  boundFs = fs;
};

export const unbindBackgroundFs = (): void => {
  boundFs = undefined;
};

export const getBackgroundFs = (): BackgroundFs | undefined => boundFs;

export const wallpaperScreenFill = (
  fallback: string,
  hasWallpaper: boolean,
): string => (hasWallpaper ? 'transparent' : fallback);

const extFromName = (name: string): string | undefined => {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return undefined;
  return name.slice(i + 1).toLowerCase();
};

const extFromMime = (mimeType: string | undefined): string | undefined => {
  if (mimeType === undefined) return undefined;
  const lower = mimeType.toLowerCase();
  if (lower === 'image/jpeg') return 'jpg';
  if (lower === 'image/svg+xml') return 'svg';
  if (lower.startsWith('image/')) {
    const rest = lower.slice('image/'.length);
    return rest === '' ? undefined : rest;
  }
  return undefined;
};

export const backgroundExtension = (
  name: string,
  mimeType?: string,
): string | undefined => {
  const fromName = extFromName(name);
  if (fromName === 'svg') return 'svg';
  if (fromName !== undefined && RASTER_EXT.has(fromName)) return fromName;
  const fromMime = extFromMime(mimeType);
  if (fromMime === 'svg') return 'svg';
  if (fromMime !== undefined && RASTER_EXT.has(fromMime)) return fromMime;
  return undefined;
};

export const validateBackgroundSource = (
  input: Pick<BackgroundSource, 'name' | 'mimeType' | 'size'>,
):
  | { ok: true; ext: string }
  | { ok: false; reason: 'tooLarge' | 'unsupported' } => {
  if (input.size > MAX_ATTACHMENT_BYTES)
    return { ok: false, reason: 'tooLarge' };
  const ext = backgroundExtension(input.name, input.mimeType);
  if (ext === undefined || ext === 'svg') {
    return { ok: false, reason: 'unsupported' };
  }
  return { ok: true, ext };
};

const newBackgroundId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const copyBackgroundFile = async (
  input: BackgroundSource,
  fs: BackgroundFs,
  id: string = newBackgroundId(),
): Promise<BackgroundInstallResult> => {
  const checked = validateBackgroundSource(input);
  if (checked.ok === false) return checked;
  const destUri = fs.joinManaged(`new-thread-background-${id}.${checked.ext}`);
  try {
    await fs.copyFile(input.uri, destUri);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return {
    ok: true,
    background: { uri: destUri, name: input.name },
  };
};

export const retireManagedBackground = async (
  fs: BackgroundFs,
  previous: NewThreadComposerBackground | undefined,
  nextUri: string,
): Promise<void> => {
  if (previous === undefined) return;
  if (previous.uri === nextUri) return;
  if (!fs.isManagedUri(previous.uri)) return;
  await fs.deleteFile(previous.uri).catch(() => {});
};

export const backgroundFileExists = async (uri: string): Promise<boolean> => {
  if (boundFs === undefined) return true;
  try {
    return await boundFs.fileExists(uri);
  } catch {
    return false;
  }
};
