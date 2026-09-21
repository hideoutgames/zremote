import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { SessionSheet } from './SessionSheet';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { Chat, DeviceRow } from '../zeron/protocol/types';
import {
  checkoutLabel,
  hostLabel,
  sessionTitle,
} from '../zeron/state/sessionTruth';

const relativeTime = (at: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(at).toLocaleDateString();
};

const Row = ({ label, value }: { label: string; value: string }) => {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
};

export function ThreadDetailsSheet({
  chat,
  host,
  modelLabel,
  onDismiss,
  onRename,
}: {
  chat: Chat;
  host: DeviceRow | undefined;
  modelLabel: string;
  onDismiss: () => void;
  onRename: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = Date.now();
  const hostName = hostLabel(chat, host !== undefined ? [host] : []);
  const checkout = checkoutLabel(chat);
  const info = checkout !== undefined ? `${hostName}\n${checkout}` : hostName;

  return (
    <SessionSheet onDismiss={onDismiss}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Text style={[styles.title, { color: theme.text }]}>
          {sessionTitle(chat)}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onRename}
            accessibilityRole="button"
            accessibilityLabel={t('session.rename')}
            style={[styles.action, { backgroundColor: theme.cardBackground }]}
          >
            <Icon name="pencil" size={16} color={theme.text} />
          </Pressable>
        </View>
        <Text style={[styles.section, { color: theme.textSecondary }]}>
          {t('session.details.info')}
        </Text>
        <Text style={[styles.info, { color: theme.text }]}>{info}</Text>
        <Row label={t('session.details.model')} value={modelLabel} />
        <Row
          label={t('session.details.source')}
          value={t('session.details.sourceValue')}
        />
        <Row label={t('session.details.runtime')} value={hostName} />
        <Row
          label={t('session.details.created')}
          value={relativeTime(chat.createdAt, now)}
        />
        <Row
          label={t('session.details.updated')}
          value={relativeTime(chat.lastMessageAt ?? chat.createdAt, now)}
        />
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
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
    marginBottom: 24,
  },
  action: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  info: {
    fontSize: 16,
    paddingHorizontal: 20,
    marginBottom: 20,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 16, flexShrink: 1, textAlign: 'right' },
});
