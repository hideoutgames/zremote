import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionSheet } from './SessionSheet';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { MessageEntry } from '../zeron/protocol/types';
import { collectThreadSubagents } from './transcript/detectSubagent';
import { SubAgentCard } from './transcript/SubAgentCard';

export function SubagentsSheet({
  entries,
  onDismiss,
}: {
  entries: MessageEntry[];
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const agents = useMemo(() => collectThreadSubagents(entries), [entries]);

  return (
    <SessionSheet onDismiss={onDismiss}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Text style={[styles.title, { color: theme.text }]}>
          {t('session.subagents')}
        </Text>
        {agents.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.subagents.empty')}
          </Text>
        ) : (
          <View style={styles.list}>
            {agents.map(view => (
              <SubAgentCard key={view.id} view={view} />
            ))}
          </View>
        )}
      </ScrollView>
    </SessionSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
    marginBottom: 20,
  },
  empty: {
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 12,
  },
  list: {
    paddingHorizontal: 16,
  },
});
