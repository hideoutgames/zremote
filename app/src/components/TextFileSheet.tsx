// Composer attachment text preview. Same GlassSheet chrome as the queue
// panel and thought process.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
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
        contentContainerStyle={styles.scrollContent}
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
  scroll: { flex: 1, paddingHorizontal: 20 },
  scrollContent: { paddingTop: 4, paddingBottom: 24 },
  body: { fontSize: 13, lineHeight: 18, fontFamily: 'Menlo' },
});
