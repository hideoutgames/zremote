// Device-local new-thread composer background: validate a picker asset,
// copy it into a managed folder, retire the previous managed file after
// the prefs pointer is committed. The pointer stores the file name inside
// that folder — iOS changes the app container path on update, so an
// absolute URI saved from the previous install would 404 and the artwork
// would be cleared. Pure + injectable fs so Jest does not load
// expo-file-system.

import { Image } from 'react-native';
import { MAX_ATTACHMENT_BYTES } from '../attachments/validate';
import { defaultBackgroundById } from './defaultBackgrounds';

export type NewThreadBackgroundEffect =
  | 'none'
  | 'dither'
  | 'ascii'
  | 'halftone'
  | 'scanlines';

export const NEW_THREAD_BACKGROUND_EFFECTS: readonly NewThreadBackgroundEffect[] =
  ['none', 'dither', 'ascii', 'halftone', 'scanlines'];

export const DEFAULT_BACKGROUND_EFFECT: NewThreadBackgroundEffect = 'dither';

export type CustomNewThreadBackground = {
  kind?: 'custom';
  uri: string;
  name: string;
  /**
   * Basename inside `new-thread-backgrounds/`. Stable across app updates;
   * `uri` is resolved from it against the current container.
   */
  fileName?: string;
};

export type PresetNewThreadBackground = {
  kind: 'preset';
  id: string;
};

export type NewThreadComposerBackground =
  | PresetNewThreadBackground
  | CustomNewThreadBackground;

export type BackgroundInstallReason = 'tooLarge' | 'unsupported' | 'failed';

export type BackgroundInstallResult =
  | { ok: true; background: CustomNewThreadBackground }
  | { ok: false; reason: BackgroundInstallReason };

export const isPresetBackground = (
  bg: NewThreadComposerBackground,
): bg is PresetNewThreadBackground => bg.kind === 'preset';

export const customBackgroundUri = (
  bg: NewThreadComposerBackground | undefined,
): string | undefined => {
  if (bg === undefined || isPresetBackground(bg)) return undefined;
  return resolveBackgroundUri(bg);
};

export const parseNewThreadComposerBackground = (
  raw: unknown,
): NewThreadComposerBackground | undefined => {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return undefined;
  }
  const v = raw as {
    kind?: unknown;
    id?: unknown;
    uri?: unknown;
    name?: unknown;
    fileName?: unknown;
  };
  if (v.kind === 'preset') {
    if (typeof v.id !== 'string' || v.id === '') return undefined;
    return { kind: 'preset', id: v.id };
  }
  if (typeof v.uri === 'string' && v.uri !== '' && typeof v.name === 'string') {
    const named =
      typeof v.fileName === 'string'
        ? managedBackgroundFileName(v.fileName)
        : undefined;
    const fileName = named ?? fileNameFromBackgroundUri(v.uri);
    return {
      kind: 'custom',
      uri: v.uri,
      name: v.name,
      ...(fileName !== undefined ? { fileName } : {}),
    };
  }
  if (typeof v.fileName === 'string' && typeof v.name === 'string') {
    const fileName = managedBackgroundFileName(v.fileName);
    if (fileName === undefined) return undefined;
    return { kind: 'custom', fileName, name: v.name, uri: '' };
  }
  return undefined;
};

export const resolveBackgroundUri = (
  bg: NewThreadComposerBackground,
): string | undefined => {
  if (isPresetBackground(bg)) {
    const preset = defaultBackgroundById(bg.id);
    if (preset === undefined) return undefined;
    return Image.resolveAssetSource(preset.source)?.uri;
  }
  // `uri` is the path adoptCustomBackground already checked. Prefer it so a
  // still-valid legacy path is shown; an empty uri means "resolve the
  // stable file name against the current container".
  if (bg.uri !== '') return bg.uri;
  const fs = getBackgroundFs();
  if (bg.fileName !== undefined && fs !== undefined) {
    return fs.joinManaged(bg.fileName);
  }
  return undefined;
};

export const isWallpaperAvailable = async (
  bg: NewThreadComposerBackground,
): Promise<boolean> => {
  if (isPresetBackground(bg)) {
    return defaultBackgroundById(bg.id) !== undefined;
  }
  return (await adoptCustomBackground(bg)) !== undefined;
};

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
  const fileName = `new-thread-background-${id}.${checked.ext}`;
  const destUri = fs.joinManaged(fileName);
  try {
    await fs.copyFile(input.uri, destUri);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return {
    ok: true,
    background: { kind: 'custom', uri: destUri, name: input.name, fileName },
  };
};

export const retireManagedBackground = async (
  fs: BackgroundFs,
  previous: NewThreadComposerBackground | undefined,
  nextUri: string,
): Promise<void> => {
  const prevUri = customBackgroundUri(previous);
  if (prevUri === undefined) return;
  if (prevUri === nextUri) return;
  if (!fs.isManagedUri(prevUri)) return;
  await fs.deleteFile(prevUri).catch(() => {});
};

export const backgroundFileExists = async (uri: string): Promise<boolean> => {
  if (uri === '') return false;
  if (boundFs === undefined) return true;
  try {
    return await boundFs.fileExists(uri);
  } catch {
    return false;
  }
};

/** Basename only — rejects path separators so a prefs value cannot escape the folder. */
export const managedBackgroundFileName = (
  value: string,
): string | undefined => {
  if (value === '' || value.includes('/') || value.includes('\\')) {
    return undefined;
  }
  if (value.includes('..')) return undefined;
  const ext = extFromName(value);
  if (ext === undefined || !RASTER_EXT.has(ext)) return undefined;
  return value;
};

export const fileNameFromBackgroundUri = (uri: string): string | undefined => {
  const marker = `/${NEW_THREAD_BACKGROUND_DIR}/`;
  const at = uri.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = uri.slice(at + marker.length).split(/[?#]/)[0];
  if (rest === '' || rest.includes('/')) return undefined;
  let base = rest;
  try {
    base = decodeURIComponent(rest);
  } catch {
    base = rest;
  }
  return managedBackgroundFileName(base);
};

/**
 * Rebind a custom wallpaper onto the current container. A stored absolute
 * URI from before an app update no longer exists; the bytes are still in
 * the managed folder under the same file name.
 */
export const adoptCustomBackground = async (
  bg: CustomNewThreadBackground,
): Promise<CustomNewThreadBackground | undefined> => {
  const fileName =
    bg.fileName ??
    (bg.uri !== '' ? fileNameFromBackgroundUri(bg.uri) : undefined);
  const candidate: CustomNewThreadBackground = {
    kind: 'custom',
    name: bg.name,
    uri: bg.uri,
    ...(fileName !== undefined ? { fileName } : {}),
  };
  const fs = getBackgroundFs();
  if (fileName !== undefined && fs !== undefined) {
    const current = fs.joinManaged(fileName);
    if (await backgroundFileExists(current)) {
      return { ...candidate, uri: current };
    }
  }
  if (bg.uri !== '' && (await backgroundFileExists(bg.uri))) {
    return candidate;
  }
  return undefined;
};
