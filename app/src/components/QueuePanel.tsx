// QueuePanel — port of apps/ios/Zeron/Composer/QueuePanelView.swift: rows
// from the projected doc `queue` list with per-row actions against the host
// (gated by `message-queue-actions-v1`). Edit-lease UI
// (`message-queue-edit-lease-v1`: Begin/Renew/FinishQueuedMessageEdit) is a
// documented gap — rows are read-only text here.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { QueuedMessage } from '../zeron/protocol/types';
import type { QueueActionKind } from '../zeron/runtime/sessionController';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from './Icon';

export interface QueuePanelProps {
  queue: readonly QueuedMessage[];
  /** host has `message-queue-actions-v1`. */
  actionsSupported: boolean;
  /** row ids with an in-flight action (queueActionsPending). */
  pending: ReadonlySet<string>;
  error?: string;
  /** Host supports mid-turn steering of a queued row. */
  canSteer: boolean;
  onAction: (id: string, action: QueueActionKind) => void;
}

export function QueuePanel({
  queue,
  actionsSupported,
  pending,
  error,
  canSteer,
  onAction,
}: QueuePanelProps) {
  const theme = useTheme();
  return (
    <View style={styles.panel}>
      <Text style={[styles.title, { color: theme.text }]}>
        {t('queue.title')}
      </Text>
      {error !== undefined ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}
      {queue.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('queue.empty')}
        </Text>
      ) : (
        queue.map(item => {
          const busy = pending.has(item.id);
          const gated = item.deliveryGate != null;
          return (
            <View
              key={item.id}
              style={[styles.row, { borderColor: theme.border }]}
            >
              <View style={styles.rowBody}>
                <Text
                  style={[styles.rowText, { color: theme.text }]}
                  numberOfLines={2}
                >
                  {item.text}
                </Text>
                {item.attachments !== undefined &&
                item.attachments.length > 0 ? (
                  <Text
                    style={[styles.rowMeta, { color: theme.textSecondary }]}
                  >
                    {t('queue.attachments').replace(
                      '{count}',
                      String(item.attachments.length),
                    )}
                  </Text>
                ) : null}
                {gated ? (
                  <Text
                    style={[styles.rowMeta, { color: theme.textSecondary }]}
                  >
                    {t('queue.holdForTurnEnd')}
                  </Text>
                ) : null}
              </View>
              {busy ? (
                <ActivityIndicator size="small" />
              ) : actionsSupported ? (
                <View style={styles.actions}>
                  {canSteer &&
                  !gated &&
                  // The host rejects steering rows that carry attachments
                  // (doc_host.rs: "cannot be steered mid-turn").
                  (item.attachments?.length ?? 0) === 0 ? (
                    <Pressable
                      hitSlop={6}
                      accessibilityLabel={t('queue.steerNow')}
                      onPress={() => onAction(item.id, 'steerNow')}
                    >
                      <Icon
                        name="arrow.right.doc.on.clipboard"
                        size={16}
                        color={theme.accent}
                      />
                    </Pressable>
                  ) : null}
                  {!gated ? (
                    <Pressable
                      hitSlop={6}
                      accessibilityLabel={t('queue.sendNow')}
                      onPress={() => onAction(item.id, 'sendNow')}
                    >
                      <Icon
                        name="paperplane.fill"
                        size={16}
                        color={theme.accent}
                      />
                    </Pressable>
                  ) : null}
                  <Pressable
                    hitSlop={6}
                    accessibilityLabel={t('queue.remove')}
                    onPress={() => onAction(item.id, 'remove')}
                  >
                    <Icon name="trash" size={16} color={theme.danger} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
  error: { fontSize: 12 },
  empty: { fontSize: 13, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
  },
  rowBody: { flex: 1, gap: 2 },
  rowText: { fontSize: 14 },
  rowMeta: { fontSize: 11 },
  actions: { flexDirection: 'row', gap: 14 },
});
