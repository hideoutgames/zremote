// Light + dark palettes. Components read the active theme via `useTheme()`
// (driven by useColorScheme); `theme` stays exported as the dark palette for
// non-hook call sites that can't take a hook.

import { useColorScheme } from 'react-native';

export interface Theme {
  scheme: 'light' | 'dark';
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  userBubbleBackground: string;
  userBubbleText: string;
  // Background used wherever liquid glass is not available.
  glassFallbackBackground: string;
  border: string;
  sendActive: string;
  sendInactive: string;
  danger: string;
  accent: string;
  // Session status dots (proto/view.rs dot palette, approximated to sRGB).
  indicatorAwaitingInput: string;
  indicatorErrored: string;
  indicatorWorking: string;
  indicatorCompleted: string;
  // Composer / cards.
  inputBackground: string;
  cardBackground: string;
  planBadge: string;
  planBadgeFill: string;
  planButton: string;
  /** Composer effort chip when Fast mode is on. */
  fastAccent: string;
  prOpen: string;
  prMerged: string;
  prDraft: string;
  // Diff rows.
  diffAddBackground: string;
  diffDelBackground: string;
  diffAddText: string;
  diffDelText: string;
}

export const darkTheme: Theme = {
  scheme: 'dark',
  background: '#000000',
  surface: '#1C1C1E',
  text: '#FFFFFF',
  textSecondary: '#8E8E93',
  userBubbleBackground: '#1C1C1E',
  userBubbleText: '#FFFFFF',
  glassFallbackBackground: '#1C1C1E',
  border: '#2C2C2E',
  sendActive: '#FFFFFF',
  sendInactive: '#48484A',
  danger: '#D7263D',
  accent: '#0A84FF',
  indicatorAwaitingInput: '#E5A50A',
  indicatorErrored: '#D7263D',
  indicatorWorking: '#0A84FF',
  indicatorCompleted: '#30D158',
  inputBackground: '#1C1C1E',
  cardBackground: '#1C1C1E',
  planBadge: '#C7934A',
  planBadgeFill: 'rgba(199,147,74,0.22)',
  planButton: '#E8A317',
  fastAccent: '#FF9F0A',
  prOpen: '#30D158',
  prMerged: '#BF5AF2',
  prDraft: '#8E8E93',
  diffAddBackground: 'rgba(48,209,88,0.14)',
  diffDelBackground: 'rgba(215,38,61,0.14)',
  diffAddText: '#30D158',
  diffDelText: '#FF6B6B',
};

export const lightTheme: Theme = {
  scheme: 'light',
  background: '#FFFFFF',
  surface: '#F2F2F7',
  text: '#000000',
  textSecondary: '#6C6C70',
  userBubbleBackground: '#E9E9EB',
  userBubbleText: '#000000',
  glassFallbackBackground: '#F2F2F7',
  border: '#D1D1D6',
  sendActive: '#000000',
  sendInactive: '#AEAEB2',
  danger: '#D7263D',
  accent: '#007AFF',
  indicatorAwaitingInput: '#C93400',
  indicatorErrored: '#D7263D',
  indicatorWorking: '#007AFF',
  indicatorCompleted: '#248A3D',
  inputBackground: '#F2F2F7',
  cardBackground: '#F2F2F7',
  planBadge: '#B07828',
  planBadgeFill: 'rgba(176,120,40,0.16)',
  planButton: '#E8A317',
  fastAccent: '#FF9F0A',
  prOpen: '#248A3D',
  prMerged: '#8944AB',
  prDraft: '#6C6C70',
  diffAddBackground: 'rgba(36,138,61,0.12)',
  diffDelBackground: 'rgba(215,38,61,0.10)',
  diffAddText: '#248A3D',
  diffDelText: '#D7263D',
};

/** Dark default for non-hook call sites (module-level styles are re-evaluated
 * per theme in the components that matter). */
export const theme = darkTheme;

export const useTheme = (): Theme =>
  useColorScheme() === 'light' ? lightTheme : darkTheme;

export const useColorSchemeName = (): 'light' | 'dark' =>
  useColorScheme() === 'light' ? 'light' : 'dark';

// Shared markdown design tokens. markdownStyle derives the
// EnrichedMarkdownText style from these, so the transcript and the reasoning
// trace share one typography source.
export const markdownTokens = {
  bodyFontSize: 16,
  bodyLineHeight: 22,
  linkColor: '#0A84FF',
  codeFontSize: 14,
  headings: {
    1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
    2: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
    3: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  },
} as const;
