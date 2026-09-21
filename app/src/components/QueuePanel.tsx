// QueuePanel — icon-only send-now / delete, drag handle to reorder.
// Edit-lease UI remains a documented gap.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
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
import { alertLocalQueuedInfo } from './queueAlerts';

const ROW_H = 56;

export interface QueuePanelProps {
  queue: readonly QueuedMessage[];
  actionsSupported: boolean;
  pending: ReadonlySet<string>;
  localIds?: ReadonlySet<string>;
  error?: string;
  canSteer: boolean;
  onAction: (id: string, action: QueueActionKind) => void;
  onMove?: (id: string, toIndex: number) => void;
  onDragging?: (dragging: boolean) => void;
}

export function QueuePanel({
  queue,
  actionsSupported,
  pending,
  localIds,
  error,
  canSteer,
  onAction,
  onMove,
  onDragging,
}: QueuePanelProps) {
  const theme = useTheme();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const startIndex = useRef(0);

  return (
    <View style={styles.panel}>
      {error !== undefined ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}
      {queue.length === 0 ? (
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('queue.empty')}
        </Text>
      ) : (
        queue.map((item, index) => {
          const busy = pending.has(item.id);
          const gated = item.deliveryGate != null;
          const dragging = dragId === item.id;
          const handle = PanResponder.create({
            onStartShouldSetPanResponder: () => onMove !== undefined,
            onMoveShouldSetPanResponder: () => onMove !== undefined,
            onPanResponderTerminationRequest: () => false,
            onShouldBlockNativeResponder: () => true,
            onPanResponderGrant: () => {
              startIndex.current = index;
              setDragId(item.id);
              setDragDy(0);
              onDragging?.(true);
            },
            onPanResponderMove: (_e, g) => setDragDy(g.dy),
            onPanResponderRelease: (_e, g) => {
              const delta = Math.round(g.dy / ROW_H);
              const next = Math.min(
                Math.max(startIndex.current + delta, 0),
                queue.length - 1,
              );
              setDragId(null);
              setDragDy(0);
              onDragging?.(false);
              if (next !== startIndex.current) onMove?.(item.id, next);
            },
            onPanResponderTerminate: () => {
              setDragId(null);
              setDragDy(0);
              onDragging?.(false);
            },
          });
          return (
            <View
              key={item.id}
              testID="queue-row"
              style={[
                styles.row,
                dragging
                  ? [styles.dragging, { transform: [{ translateY: dragDy }] }]
                  : undefined,
              ]}
            >
              {onMove !== undefined ? (
                <View
                  {...handle.panHandlers}
                  testID="queue-reorder-handle"
                  style={styles.handle}
                  accessibilityLabel={t('queue.reorder')}
                >
                  <Icon
                    name="line.3.horizontal"
                    size={14}
                    color={theme.textSecondary}
                  />
                </View>
              ) : null}
              {localIds?.has(item.id) === true ? (
                <Pressable
                  hitSlop={6}
                  testID="queue-local-info"
                  accessibilityRole="button"
                  accessibilityLabel={t('queue.localInfo')}
                  onPress={alertLocalQueuedInfo}
                  style={styles.localInfo}
                >
                  <Icon
                    name="info.circle"
                    size={16}
                    color={theme.textSecondary}
                  />
                </Pressable>
              ) : null}
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
                  (item.attachments?.length ?? 0) === 0 ? (
                    <Pressable
                      hitSlop={6}
                      accessibilityRole="button"
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
                      accessibilityRole="button"
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
                    accessibilityRole="button"
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
  panel: { gap: 8, paddingHorizontal: 16, backgroundColor: 'transparent' },
  error: { fontSize: 12 },
  empty: { fontSize: 13, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    paddingVertical: 10,
    minHeight: ROW_H,
  },
  dragging: { zIndex: 2 },
  handle: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localInfo: {
    width: 28,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowText: { fontSize: 14 },
  rowMeta: { fontSize: 11 },
  actions: { flexDirection: 'row', gap: 14 },
});
