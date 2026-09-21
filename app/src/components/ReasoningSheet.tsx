import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { markdownMd4cFlags, markdownStyleFor } from '../markdownStyle';
import { t } from '../i18n/strings';
import { GlassSheet } from './GlassSheet';
import { useTheme } from '../theme';

type ReasoningSheetProps = {
  reasoning: string;
  onDismiss: () => void;
};

export const ReasoningSheet = React.memo(function ({
  reasoning,
  onDismiss,
}: ReasoningSheetProps) {
  const theme = useTheme();

  return (
    <GlassSheet title={t('session.thoughtProcess')} onDismiss={onDismiss}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <EnrichedMarkdownText
          markdown={reasoning}
          markdownStyle={markdownStyleFor(theme)}
          md4cFlags={markdownMd4cFlags}
          flavor="github"
        />
      </ScrollView>
    </GlassSheet>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1, paddingHorizontal: 20 },
  scrollContent: { paddingTop: 4, paddingBottom: 24 },
});
