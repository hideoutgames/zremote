// Expo Go preview shim — not used in production builds.
// react-native-enriched-markdown is a Nitro view; in Go we render with the
// pure-JS react-native-markdown-display. `streamingAnimation` is ignored.

import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

/** The production `MarkdownStyle` slots, loosely mapped onto
 * markdown-display's style keys. Unknown/extra keys are ignored there. */
type AnyStyle = Record<string, unknown>;

const toMarkdownDisplayStyle = (s: AnyStyle | undefined): AnyStyle => {
  if (s === undefined) return {};
  const p = (s.paragraph ?? {}) as AnyStyle;
  const code = (s.code ?? {}) as AnyStyle;
  const codeBlock = (s.codeBlock ?? {}) as AnyStyle;
  return {
    body: { color: p.color },
    heading1: s.h1,
    heading2: s.h2,
    heading3: s.h3,
    heading4: s.h4,
    heading5: s.h5,
    heading6: s.h6,
    strong: s.strong,
    em: s.em,
    link: s.link,
    blockquote: {
      color: (s.blockquote as AnyStyle)?.color,
      borderLeftColor: (s.blockquote as AnyStyle)?.borderColor,
      borderLeftWidth: 3,
      paddingHorizontal: 12,
    },
    code_inline: {
      color: code.color,
      backgroundColor: code.backgroundColor,
      fontFamily: 'Menlo',
    },
    fence: {
      color: codeBlock.color,
      backgroundColor: codeBlock.backgroundColor,
      borderColor: codeBlock.borderColor,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      padding: 12,
      fontFamily: 'Menlo',
    },
    code_block: {
      color: codeBlock.color,
      backgroundColor: codeBlock.backgroundColor,
      fontFamily: 'Menlo',
    },
    hr: { backgroundColor: (s.thematicBreak as AnyStyle)?.color },
    table: { borderColor: (s.table as AnyStyle)?.borderColor },
    th: {
      color: (s.table as AnyStyle)?.headerTextColor,
      backgroundColor: (s.table as AnyStyle)?.headerBackgroundColor,
    },
    bullet_list: { color: (s.list as AnyStyle)?.color },
    ordered_list: { color: (s.list as AnyStyle)?.color },
  };
};

export interface EnrichedMarkdownTextProps {
  markdown: string;
  markdownStyle?: AnyStyle;
  flavor?: string;
  streamingAnimation?: boolean;
  onLinkPress?: (link: { url: string }) => boolean | void;
}

export const EnrichedMarkdownText = ({
  markdown,
  markdownStyle,
  onLinkPress,
}: EnrichedMarkdownTextProps) => (
  <Markdown
    style={toMarkdownDisplayStyle(markdownStyle)}
    onLinkPress={url => {
      const r = onLinkPress?.({ url });
      if (r === false) return false;
      if (onLinkPress === undefined) Linking.openURL(url).catch(() => {});
      return true;
    }}
  >
    {markdown}
  </Markdown>
);

export default EnrichedMarkdownText;
