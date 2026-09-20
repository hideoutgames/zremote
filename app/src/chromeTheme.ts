// Glass chrome follows the system theme, except when a session wallpaper
// is set — then buttons always use dark material so they stay readable
// on artwork. Transcript content keeps `useTheme()` (luma / system).

import { darkTheme, useTheme, type Theme } from './theme';
import { useNewThreadComposerBackground } from './zeron/state/uiPrefs';

export const chromeThemeFor = (
  wallpaperPresent: boolean,
  theme: Theme,
): Theme => (wallpaperPresent ? darkTheme : theme);

export const useChromeTheme = (): Theme => {
  const theme = useTheme();
  const wallpaper = useNewThreadComposerBackground() !== undefined;
  return chromeThemeFor(wallpaper, theme);
};
