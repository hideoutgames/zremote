// Copies a text-file body. Shared by the attachment preview, the workspace
// file editor, and the local-log viewer.

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function CopyTextButton({
  text,
  disabled = false,
}: {
  text: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    if (disabled || text === '') return;
    Clipboard.setStringAsync(text).catch(() => {});
    setCopied(true);
  }, [disabled, text]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <Pressable
      testID="copy-text"
      onPress={onCopy}
      disabled={disabled || text === ''}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('common.copy')}
      accessibilityState={{ disabled: disabled || text === '' }}
      style={styles.btn}
    >
      <Icon
        name={copied ? 'checkmark' : 'square.on.square'}
        size={16}
        color={disabled || text === '' ? theme.textSecondary : theme.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
