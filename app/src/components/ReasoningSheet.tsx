import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { darkMarkdownStyle } from '../markdownStyle';
import { t } from '../i18n/strings';
import { GlassSheet } from './GlassSheet';

type ReasoningSheetProps = {
  reasoning: string;
  onDismiss: () => void;
};

export const ReasoningSheet = React.memo(function ({
  reasoning,
  onDismiss,
}: ReasoningSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <GlassSheet title={t('session.thoughtProcess')} onDismiss={onDismiss}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <EnrichedMarkdownText
          markdown={reasoning}
          markdownStyle={darkMarkdownStyle}
          flavor="github"
        />
      </ScrollView>
    </GlassSheet>
  );
});

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20 },
  scrollContent: { paddingTop: 4 },
});
