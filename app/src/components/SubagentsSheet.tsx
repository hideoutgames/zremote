import React, { useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Icon } from './Icon';
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
  const sheet = useRef<TrueSheet>(null);
  const agents = useMemo(() => collectThreadSubagents(entries), [entries]);

  return (
    <TrueSheet
      ref={sheet}
      detents={[1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      grabber
      backgroundColor={theme.background}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => sheet.current?.dismiss()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('session.back')}
        >
          <View style={[styles.closeButton, { borderColor: theme.border }]}>
            <Icon name="xmark" size={15} color={theme.text} />
          </View>
        </Pressable>
      </View>
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
    </TrueSheet>
  );
}

const CLOSE = 32;

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
