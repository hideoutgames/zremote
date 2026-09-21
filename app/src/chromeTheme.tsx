// Threads-list glass sits on a hardcoded dark frost, so those buttons
// use dark material when a wallpaper is set. Composer and session
// chrome follow `useTheme()` (wallpaper luma / system).

import React, { createContext, useContext, type ReactNode } from 'react';
import { darkTheme, useTheme, type Theme } from './theme';

const ChromeThemeContext = createContext<Theme | undefined>(undefined);

export const chromeThemeFor = (
  wallpaperPresent: boolean,
  theme: Theme,
): Theme => (wallpaperPresent ? darkTheme : theme);

export function ChromeThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: ReactNode;
}) {
  return (
    <ChromeThemeContext.Provider value={theme}>
      {children}
    </ChromeThemeContext.Provider>
  );
}

export const useChromeTheme = (): Theme => {
  const scoped = useContext(ChromeThemeContext);
  const theme = useTheme();
  return scoped ?? theme;
};
