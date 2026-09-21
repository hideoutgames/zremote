// QueuePanel — icon-only send-now / delete, drag handle to reorder.
// Edit-lease UI remains a documented gap.

import React, { useMemo, useRef, useState } from 'react';
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
/** Row min height + the panel's 8pt row gap — the per-row pitch a drag of
 * one slot travels. */
const ROW_PITCH = ROW_H + 8;

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

interface QueueRowProps {
  item: QueuedMessage;
  index: number;
  queueLength: number;
  actionsSupported: boolean;
  busy: boolean;
  isLocal: boolean;
  canSteer: boolean;
  dragging: boolean;
  dragDy: number;
  onAction: (id: string, action: QueueActionKind) => void;
  onMove?: (id: string, toIndex: number) => void;
  onDragging?: (dragging: boolean) => void;
  onDragStart: (id: string) => void;
  onDragMove: (dy: number) => void;
  onDragEnd: () => void;
}

/** One queue row. The PanResponder is created once per row and reads
 * index/length/callbacks through refs — recreating it mid-gesture (which a
 * `dragDy` re-render per move used to do) resets its gesture state and the
 * release delta collapses to ~0, silently dropping the reorder. */
function QueueRow({
  item,
  index,
  queueLength,
  actionsSupported,
  busy,
  isLocal,
  canSteer,
  dragging,
  dragDy,
  onAction,
  onMove,
  onDragging,
  onDragStart,
  onDragMove,
  onDragEnd,
}: QueueRowProps) {
  'use no memo';
  const theme = useTheme();
  const gated = item.deliveryGate != null;

  const itemId = useRef(item.id);
  const startIndex = useRef(index);
  const lengthRef = useRef(queueLength);
  const callbacks = useRef({
    onMove,
    onDragging,
    onDragStart,
    onDragMove,
    onDragEnd,
  });
  itemId.current = item.id;
  startIndex.current = index;
  lengthRef.current = queueLength;
  callbacks.current = {
    onMove,
    onDragging,
    onDragStart,
    onDragMove,
    onDragEnd,
  };

  const enabledRef = useRef(onMove !== undefined);
  enabledRef.current = onMove !== undefined;

  const handle = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabledRef.current,
        onMoveShouldSetPanResponder: () => enabledRef.current,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          callbacks.current.onDragStart(itemId.current);
          callbacks.current.onDragging?.(true);
        },
        onPanResponderMove: (_e, g) => callbacks.current.onDragMove(g.dy),
        onPanResponderRelease: (_e, g) => {
          const delta = Math.round(g.dy / ROW_PITCH);
          const next = Math.min(
            Math.max(startIndex.current + delta, 0),
            lengthRef.current - 1,
          );
          callbacks.current.onDragEnd();
          callbacks.current.onDragging?.(false);
          if (next !== startIndex.current)
            callbacks.current.onMove?.(itemId.current, next);
        },
        onPanResponderTerminate: () => {
          callbacks.current.onDragEnd();
          callbacks.current.onDragging?.(false);
        },
      }),
    [],
  );

  return (
    <View
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
          hitSlop={8}
          accessibilityLabel={t('queue.reorder')}
        >
          <Icon
            name="line.3.horizontal"
            size={14}
            color={theme.textSecondary}
          />
        </View>
      ) : null}
      {isLocal ? (
        <Pressable
          hitSlop={6}
          testID="queue-local-info"
          accessibilityRole="button"
          accessibilityLabel={t('queue.localInfo')}
          onPress={alertLocalQueuedInfo}
          style={styles.localInfo}
        >
          <Icon name="info.circle" size={16} color={theme.textSecondary} />
        </Pressable>
      ) : null}
      <View style={styles.rowBody}>
        <Text style={[styles.rowText, { color: theme.text }]} numberOfLines={2}>
          {item.text}
        </Text>
        {item.attachments !== undefined && item.attachments.length > 0 ? (
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
            {t('queue.attachments').replace(
              '{count}',
              String(item.attachments.length),
            )}
          </Text>
        ) : null}
        {gated ? (
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
            {t('queue.holdForTurnEnd')}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" />
      ) : actionsSupported ? (
        <View style={styles.actions}>
          {canSteer && !gated && (item.attachments?.length ?? 0) === 0 ? (
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
              <Icon name="paperplane.fill" size={16} color={theme.accent} />
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
        queue.map((item, index) => (
          <QueueRow
            key={item.id}
            item={item}
            index={index}
            queueLength={queue.length}
            actionsSupported={actionsSupported}
            busy={pending.has(item.id)}
            isLocal={localIds?.has(item.id) === true}
            canSteer={canSteer}
            dragging={dragId === item.id}
            dragDy={dragDy}
            onAction={onAction}
            onMove={onMove}
            onDragging={onDragging}
            onDragStart={setDragId}
            onDragMove={setDragDy}
            onDragEnd={() => {
              setDragId(null);
              setDragDy(0);
            }}
          />
        ))
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
