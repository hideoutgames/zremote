// PR modal: state, markdown title/body, and the checkout diff list.

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { darkMarkdownStyle, lightMarkdownStyle } from '../markdownStyle';
import { ChangesScreen } from '../screens/ChangesScreen';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { PrBadgeModel } from './prBadge';

export function PrSheet({
  chatId,
  badge,
  onDismiss,
}: {
  chatId: string;
  badge: PrBadgeModel;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toneColor = badge.tone === 'merged' ? theme.prMerged : theme.prOpen;
  const body =
    badge.body !== undefined && badge.body !== '' ? badge.body : undefined;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <View
        style={[
          styles.fill,
          { backgroundColor: theme.background, paddingTop: insets.top },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={onDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('session.back')}
          >
            <Glass style={styles.close}>
              <Icon name="xmark" size={15} color={theme.text} />
            </Glass>
          </Pressable>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {badge.title !== '' ? badge.title : `#${badge.number}`}
          </Text>
          <View style={styles.close} />
        </View>
        <ScrollView contentContainerStyle={styles.meta}>
          <Text style={[styles.state, { color: toneColor }]}>
            {badge.tone === 'merged'
              ? t('pr.merged')
              : badge.tone === 'draft'
              ? t('pr.draft')
              : t('pr.open')}
            {` · #${badge.number}`}
          </Text>
          <Text style={[styles.refs, { color: theme.textSecondary }]}>
            {`${badge.baseRef} ← ${badge.headRef}`}
          </Text>
          {body !== undefined ? (
            <EnrichedMarkdownText
              markdown={body}
              markdownStyle={
                theme.scheme === 'dark' ? darkMarkdownStyle : lightMarkdownStyle
              }
              flavor="github"
            />
          ) : null}
        </ScrollView>
        <View style={styles.diffs}>
          <ChangesScreen chatId={chatId} embedded />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  meta: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  state: { fontSize: 14, fontWeight: '600' },
  refs: { fontSize: 12 },
  diffs: { flex: 1, minHeight: 220 },
});
