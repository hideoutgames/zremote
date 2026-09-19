import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { markdownStyleFor } from '../../markdownStyle';
import { useTheme } from '../../theme';
import { CodeFenceBlock } from './CodeFenceBlock';
import { splitMarkdownFences } from './splitMarkdownFences';

export { CodeFenceBlock } from './CodeFenceBlock';

export function MarkdownWithCopy({
  markdown,
  streaming,
}: {
  markdown: string;
  streaming?: boolean;
}) {
  const theme = useTheme();
  const mdStyle = markdownStyleFor(theme);
  const segments = splitMarkdownFences(markdown);
  if (segments.length === 0) return null;
  const onlyProse =
    segments.length === 1 && segments[0].kind === 'prose'
      ? segments[0]
      : undefined;
  if (onlyProse !== undefined) {
    return (
      <EnrichedMarkdownText
        markdown={onlyProse.text}
        markdownStyle={mdStyle}
        flavor="github"
        streamingAnimation={streaming === true}
        onLinkPress={({ url }) => {
          if (url === 'zeron:pending-link') return;
          Linking.openURL(url);
        }}
      />
    );
  }
  return (
    <View style={styles.stack}>
      {segments.map((seg, i) =>
        seg.kind === 'code' ? (
          <CodeFenceBlock key={`code-${i}`} lang={seg.lang} text={seg.text} />
        ) : (
          <EnrichedMarkdownText
            key={`prose-${i}`}
            markdown={seg.text}
            markdownStyle={mdStyle}
            flavor="github"
            streamingAnimation={streaming === true && i === segments.length - 1}
            onLinkPress={({ url }) => {
              if (url === 'zeron:pending-link') return;
              Linking.openURL(url);
            }}
          />
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
});
