// QueueSheet — TrueSheet chrome matching Thought process (ReasoningSheet):
// grabber, auto/full detents, close + centered title. Rows are Liquid Glass
// chips with icon actions and a drag handle that reorders via onMove.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import type { QueuedMessage } from '../zeron/protocol/types';
import type { QueueActionKind } from '../zeron/runtime/sessionController';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Glass } from './Glass';
import { Icon } from './Icon';

const ROW = 64;
const CLOSE = 32;

export interface QueueSheetProps {
  queue: readonly QueuedMessage[];
  actionsSupported: boolean;
  pending: ReadonlySet<string>;
  error?: string;
  canSteer: boolean;
  onAction: (id: string, action: QueueActionKind) => void;
  onMove: (id: string, toIndex: number) => void;
  onDismiss: () => void;
}

export const QueueSheet = React.memo(function QueueSheet({
  queue,
  actionsSupported,
  pending,
  error,
  canSteer,
  onAction,
  onMove,
  onDismiss,
}: QueueSheetProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const sheet = useRef<TrueSheet>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto', 1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      maxContentHeight={620}
      grabber
    >
      <View style={styles.header}>
        <Pressable onPress={() => sheet.current?.dismiss()} hitSlop={8}>
          <View style={[styles.closeButton, { borderColor: theme.border }]}>
            <Icon name="xmark" size={15} color={theme.text} />
          </View>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>
          {t('queue.title')}
        </Text>
        <View style={styles.closeButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
      >
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
              count={queue.length}
              busy={pending.has(item.id)}
              actionsSupported={actionsSupported}
              canSteer={canSteer}
              onAction={onAction}
              onMove={onMove}
              onDragChange={setDragging}
            />
          ))
        )}
      </ScrollView>
    </TrueSheet>
  );
});

function QueueRow({
  item,
  index,
  count,
  busy,
  actionsSupported,
  canSteer,
  onAction,
  onMove,
  onDragChange,
}: {
  item: QueuedMessage;
  index: number;
  count: number;
  busy: boolean;
  actionsSupported: boolean;
  canSteer: boolean;
  onAction: (id: string, action: QueueActionKind) => void;
  onMove: (id: string, toIndex: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const translateY = useRef(new Animated.Value(0)).current;
  const gated = item.deliveryGate != null;
  const canSteerRow =
    canSteer && !gated && (item.attachments?.length ?? 0) === 0;

  const indexRef = useRef(index);
  indexRef.current = index;
  const countRef = useRef(count);
  countRef.current = count;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onDragChangeRef = useRef(onDragChange);
  onDragChangeRef.current = onDragChange;
  const idRef = useRef(item.id);
  idRef.current = item.id;

  const moveTo = (to: number) => {
    const from = indexRef.current;
    const clamped = Math.max(0, Math.min(countRef.current - 1, to));
    if (clamped !== from) onMoveRef.current(idRef.current, clamped);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => onDragChangeRef.current(true),
      onPanResponderMove: (_, g) => translateY.setValue(g.dy),
      onPanResponderRelease: (_, g) => {
        const delta = Math.round(g.dy / ROW);
        translateY.setValue(0);
        onDragChangeRef.current(false);
        moveTo(indexRef.current + delta);
      },
      onPanResponderTerminate: () => {
        translateY.setValue(0);
        onDragChangeRef.current(false);
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.rowLift, { transform: [{ translateY }], zIndex: 1 }]}
    >
      <Glass effect="clear" style={styles.row}>
        <View
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={t('queue.reorder')}
          accessibilityValue={{ text: String(index + 1), min: 1, max: count }}
          accessibilityActions={[
            { name: 'decrement', label: t('queue.moveUp') },
            { name: 'increment', label: t('queue.moveDown') },
          ]}
          onAccessibilityAction={e => {
            if (e.nativeEvent.actionName === 'decrement') moveTo(index - 1);
            if (e.nativeEvent.actionName === 'increment') moveTo(index + 1);
          }}
          style={styles.handle}
        >
          <Icon
            name={'line.3.horizontal' as never}
            size={16}
            color={theme.textSecondary}
          />
        </View>
        <View style={styles.rowBody}>
          <Text
            style={[styles.rowText, { color: theme.text }]}
            numberOfLines={2}
          >
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
            {canSteerRow ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('queue.steerNow')}
                onPress={() => onAction(item.id, 'steerNow')}
                style={styles.action}
              >
                <Icon
                  name={'arrow.right.doc.on.clipboard' as never}
                  size={16}
                  color={theme.accent}
                />
              </Pressable>
            ) : null}
            {!gated ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('queue.sendNow')}
                onPress={() => onAction(item.id, 'sendNow')}
                style={styles.action}
              >
                <Icon
                  name={'paperplane.fill' as never}
                  size={16}
                  color={theme.accent}
                />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('queue.remove')}
              onPress={() => onAction(item.id, 'remove')}
              style={styles.action}
            >
              <Icon name={'trash' as never} size={16} color={theme.danger} />
            </Pressable>
          </View>
        ) : null}
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: CLOSE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  scroll: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingTop: 4,
    gap: 8,
  },
  error: { fontSize: 12 },
  empty: { fontSize: 13, paddingVertical: 12 },
  rowLift: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 52,
  },
  handle: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowText: { fontSize: 14 },
  rowMeta: { fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  action: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
