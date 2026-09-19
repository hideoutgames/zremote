import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { markdownStyleFor } from '../../markdownStyle';
import { t } from '../../i18n/strings';
import { splitMarkdownFences } from './splitMarkdownFences';

export function CodeFenceBlock({ lang, text }: { lang: string; text: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    Clipboard.setStringAsync(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return (
    <View
      testID="code-fence"
      style={[
        styles.fence,
        {
          backgroundColor: theme.userBubbleBackground,
          borderColor: theme.border,
        },
      ]}
    >
      {lang !== '' ? (
        <Text
          style={[styles.lang, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {lang}
        </Text>
      ) : null}
      <Text selectable style={[styles.code, { color: theme.text }]}>
        {text}
      </Text>
      <Pressable
        testID="code-fence-copy"
        onPress={onCopy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.copy')}
        style={[
          styles.copy,
          {
            backgroundColor: theme.glassFallbackBackground,
            borderColor: theme.border,
          },
        ]}
      >
        <Icon
          name={copied ? 'checkmark' : 'square.on.square'}
          size={14}
          color={theme.text}
        />
      </Pressable>
    </View>
  );
}

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
  fence: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    paddingTop: 28,
    overflow: 'hidden',
  },
  lang: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  code: { fontSize: 14, lineHeight: 20, fontFamily: 'Menlo' },
  copy: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
