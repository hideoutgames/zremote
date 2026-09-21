// Wallpaper contrast: sample average luma and pick a chrome scheme so
// text/icons follow the artwork instead of system light/dark. Sampling
// lives in NewThreadBackground (Skia); this module is the store + math.

import { createStore, useStore } from 'zustand';

export type WallpaperContrastScheme = 'light' | 'dark';

export const WALLPAPER_LUMA_CUTOFF = 0.55;

export const luminanceOfRgb = (r: number, g: number, b: number): number =>
  (0.299 * r + 0.587 * g + 0.114 * b) / 255;

export const contrastSchemeFromLuminance = (
  luma: number,
): WallpaperContrastScheme =>
  luma >= WALLPAPER_LUMA_CUTOFF ? 'light' : 'dark';

/** Wallpaper present → sampled scheme, else light text on a dark scrim. */
export const chromeSchemeForWallpaper = (
  wallpaperUri: string | undefined,
  sampled: WallpaperContrastScheme | undefined,
  system: WallpaperContrastScheme,
): WallpaperContrastScheme =>
  wallpaperUri === undefined ? system : sampled ?? 'dark';

export const averageLuminanceFromRgba = (
  pixels: ArrayLike<number>,
): number | undefined => {
  if (pixels.length < 4) return undefined;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    sum += luminanceOfRgb(pixels[i], pixels[i + 1], pixels[i + 2]);
    n += 1;
  }
  return n === 0 ? undefined : sum / n;
};

type ContrastState = {
  uri: string | undefined;
  scheme: WallpaperContrastScheme | undefined;
};

const contrastStore = createStore<ContrastState>(() => ({
  uri: undefined,
  scheme: undefined,
}));

export const setWallpaperContrast = (
  uri: string | undefined,
  scheme: WallpaperContrastScheme | undefined,
): void => {
  contrastStore.setState({ uri, scheme });
};

export const wallpaperContrastState = (): ContrastState =>
  contrastStore.getState();

export const useWallpaperContrastScheme = ():
  | WallpaperContrastScheme
  | undefined => useStore(contrastStore, s => s.scheme);

export const useWallpaperContrastUri = (): string | undefined =>
  useStore(contrastStore, s => s.uri);
