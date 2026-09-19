// Composer attachment text preview. Same GlassSheet chrome as the queue
// panel and thought process.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSheet } from './GlassSheet';
import { readFileText } from '../zeron/native/fileText';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';

export function TextFileSheet({
  title,
  uri,
  onDismiss,
}: {
  title: string;
  uri: string;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setBody(undefined);
    setError(undefined);
    readFileText(uri)
      .then(text => {
        if (live) setBody(text);
      })
      .catch(() => {
        if (live) setError(t('composer.textPreviewFailed'));
      });
    return () => {
      live = false;
    };
  }, [uri]);

  return (
    <GlassSheet title={title} onDismiss={onDismiss}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {body === undefined && error === undefined ? (
          <ActivityIndicator />
        ) : (
          <Text
            selectable
            style={[
              styles.body,
              { color: error !== undefined ? theme.danger : theme.text },
            ]}
          >
            {error ?? body}
          </Text>
        )}
      </ScrollView>
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, maxHeight: 520 },
  scrollContent: { paddingTop: 4 },
  body: { fontSize: 13, lineHeight: 18, fontFamily: 'Menlo' },
});
