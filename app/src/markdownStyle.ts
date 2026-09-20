import { StyleSheet } from 'react-native';
import type { MarkdownStyle, Md4cFlags } from 'react-native-enriched-markdown';
import { darkTheme, lightTheme, markdownTokens, type Theme } from './theme';

/** Coding-chat copy is not math. Unpaired `$` (env vars, prices, regex)
 *  would otherwise parse as LaTeX and blank the paragraph. */
export const markdownMd4cFlags: Md4cFlags = { latexMath: false };

const { bodyFontSize, bodyLineHeight, linkColor, headings } = markdownTokens;

/** react-native-enriched-markdown defaults to light mode; this maps the app
 * theme onto its style slots. Typography comes from the shared markdownTokens
 * so the streaming renderer and the final render stay in sync. */
export const markdownStyleFor = (t: Theme): MarkdownStyle => ({
  paragraph: {
    color: t.text,
    fontSize: bodyFontSize,
    lineHeight: bodyLineHeight,
  },
  h1: { color: t.text, fontSize: headings[1].fontSize, fontWeight: '700' },
  h2: { color: t.text, fontSize: headings[2].fontSize, fontWeight: '700' },
  h3: { color: t.text, fontSize: headings[3].fontSize, fontWeight: '600' },
  h4: { color: t.text, fontSize: 16, fontWeight: '600' },
  h5: { color: t.text, fontSize: 15, fontWeight: '600' },
  h6: { color: t.text, fontSize: 14, fontWeight: '600' },
  strong: { color: t.text },
  em: { color: t.text },
  link: { color: linkColor, underline: true },
  list: { color: t.text, bulletColor: t.text, markerColor: t.text },
  blockquote: { color: t.textSecondary, borderColor: t.border },
  code: {
    color: t.text,
    backgroundColor: t.userBubbleBackground,
    borderColor: t.border,
  },
  codeBlock: {
    color: t.text,
    backgroundColor: t.userBubbleBackground,
    borderColor: t.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  thematicBreak: { color: t.border },
  table: {
    color: t.text,
    fontSize: bodyFontSize,
    borderColor: t.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    headerBackgroundColor: t.userBubbleBackground,
    headerTextColor: t.text,
    rowEvenBackgroundColor: 'transparent',
    rowOddBackgroundColor: 'transparent',
    cellPaddingHorizontal: 12,
    cellPaddingVertical: 8,
  },
});

export const darkMarkdownStyle: MarkdownStyle = markdownStyleFor(darkTheme);
export const lightMarkdownStyle: MarkdownStyle = markdownStyleFor(lightTheme);
