import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '../Icon';
import { useTheme } from '../../theme';
import { t } from '../../i18n/strings';

export function CodeFenceBlock({ lang, text }: { lang: string; text: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    Clipboard.setStringAsync(text).catch(() => {});
    setCopied(true);
  }, [text]);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
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

const styles = StyleSheet.create({
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
