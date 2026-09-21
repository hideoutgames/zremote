// Codex-style message navigation rail. Semantics from beUI `preview-rail`
// (MIT) — compact ticks, hover/pin pyramid, floating destination preview.
// See docs/AGENTS_KIT_PROVENANCE.md.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { prepareSelection, selectionTick } from '../../zeron/native/haptics';
import { useTheme } from '../../theme';
import { Glass } from '../Glass';
import {
  RAIL_ITEM_SIZE,
  railIndexAtY,
  railItemSize,
  railProgressAtY,
  railYFromPage,
  tickScale,
  type RailItem,
} from './messagePreview';

export type { RailItem as PreviewRailItem };

export type PreviewRailSelectOpts = {
  animated?: boolean;
  /** 0..1 stack progress during a drag scrub. Taps omit this so the list
   *  can jump to the message (`scrollToIndex`). */
  progress?: number;
};

const RAIL_WIDTH = 28;
/** Extra grab strip on the content side of the ticks. */
const RAIL_HIT_EXTRA = 12;
const TICK_WIDTH = 16;
const TICK_HEIGHT = StyleSheet.hairlineWidth < 1 ? 1 : StyleSheet.hairlineWidth;
const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 80;
const SPRING = { stiffness: 360, damping: 32, mass: 0.6 };

function yFromEvent(e: GestureResponderEvent, originY: number | null): number {
  return railYFromPage(e.nativeEvent.pageY, e.nativeEvent.locationY, originY);
}

function RailTick({
  scale,
  color,
  reduceMotion,
}: {
  scale: number;
  color: string;
  reduceMotion: boolean;
}) {
  'use no memo';
  const scaleSv = useSharedValue(scale);
  useEffect(() => {
    scaleSv.value = scale;
  }, [scale, scaleSv]);
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX: reduceMotion
          ? scaleSv.value
          : withSpring(scaleSv.value, SPRING),
      },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.tick, { backgroundColor: color }, style]}
    />
  );
}

export function PreviewRail({
  items,
  label,
  activeId,
  onItemSelect,
  top,
  bottom,
  right,
  railHeight,
  dismissKey = 0,
}: {
  items: RailItem[];
  label: string;
  activeId: string;
  onItemSelect: (item: RailItem, opts?: PreviewRailSelectOpts) => void;
  top: number;
  bottom: number;
  right: number;
  railHeight: number;
  dismissKey?: number;
}) {
  'use no memo';
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const lastIndexRef = useRef(-1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const itemSize = railItemSize(items.length, railHeight);
  const stackHeight = itemSize * items.length;
  const stackTop =
    items.length * RAIL_ITEM_SIZE <= railHeight
      ? Math.max(0, (railHeight - stackHeight) / 2)
      : 0;
  const itemSizeRef = useRef(itemSize);
  itemSizeRef.current = itemSize;
  const stackTopRef = useRef(stackTop);
  stackTopRef.current = stackTop;
  const onItemSelectRef = useRef(onItemSelect);
  onItemSelectRef.current = onItemSelect;
  const trackRef = useRef<View>(null);
  const railPageYRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // The preview card exists to label the landing spot mid-scrub — a brief
  // linger after release, then it clears. Any other action (transcript
  // scroll via dismissKey, or simply waiting) leaves a clean screen.
  const schedulePreviewDismiss = useCallback(() => {
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = undefined;
      setPinnedId(null);
    }, 700);
  }, []);

  useEffect(() => {
    setPinnedId(null);
    if (dismissTimerRef.current !== undefined) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = undefined;
    }
  }, [dismissKey]);

  useEffect(
    () => () => {
      if (dismissTimerRef.current !== undefined) {
        clearTimeout(dismissTimerRef.current);
      }
    },
    [],
  );

  const syncRailOrigin = useCallback(() => {
    trackRef.current?.measureInWindow?.((_x, y) => {
      if (typeof y === 'number' && Number.isFinite(y)) {
        railPageYRef.current = y;
      }
    });
  }, []);

  const applyTouch = useCallback(
    (e: GestureResponderEvent, kind: 'grant' | 'move') => {
      if (dismissTimerRef.current !== undefined) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = undefined;
      }
      const y = yFromEvent(e, railPageYRef.current);
      const count = itemsRef.current.length;
      const index = railIndexAtY(
        y,
        count,
        itemSizeRef.current,
        stackTopRef.current,
      );
      const next = itemsRef.current[index];
      if (!next) return;
      if (kind === 'grant') {
        prepareSelection();
        lastIndexRef.current = index;
        setPinnedId(next.id);
        onItemSelectRef.current(next, { animated: true });
        return;
      }
      const last = index === count - 1;
      if (last && lastIndexRef.current === index) return;
      const crossed = lastIndexRef.current !== index;
      if (crossed) {
        selectionTick();
        lastIndexRef.current = index;
        setPinnedId(next.id);
      }
      if (last) {
        onItemSelectRef.current(next, { animated: false });
        return;
      }
      onItemSelectRef.current(next, {
        animated: false,
        progress: railProgressAtY(
          y,
          count,
          itemSizeRef.current,
          stackTopRef.current,
        ),
      });
    },
    [],
  );

  const selectA11y = useCallback(
    (item: RailItem) => {
      const index = itemsRef.current.findIndex(
        candidate => candidate.id === item.id,
      );
      if (index >= 0) lastIndexRef.current = index;
      setPinnedId(item.id);
      onItemSelect(item, { animated: true });
    },
    [onItemSelect],
  );

  const selectedId = items.some(item => item.id === activeId)
    ? activeId
    : items[0]?.id ?? '';
  const highlightedId = pinnedId ?? selectedId;
  const highlightedIndex = items.findIndex(item => item.id === highlightedId);
  const previewItem = items.find(item => item.id === pinnedId);
  const trackWidth = RAIL_WIDTH + RAIL_HIT_EXTRA;

  return (
    // box-none: transcript pans pass through; the 40pt track stays hittable.
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      testID="preview-rail"
      accessibilityLabel={label}
    >
      <View
        ref={trackRef}
        testID="preview-rail-track"
        pointerEvents="auto"
        style={[styles.rail, { top, bottom, right, width: trackWidth }]}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        onLayout={syncRailOrigin}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => {
          syncRailOrigin();
          applyTouch(e, 'grant');
        }}
        onResponderMove={e => {
          applyTouch(e, 'move');
        }}
        onResponderRelease={schedulePreviewDismiss}
        onResponderTerminate={schedulePreviewDismiss}
      >
        <View
          pointerEvents="none"
          style={[styles.stack, { marginTop: stackTop }]}
        >
          {items.map((item, index) => {
            const distance =
              highlightedIndex < 0
                ? Number.POSITIVE_INFINITY
                : Math.abs(index - highlightedIndex);
            const highlighted = item.id === highlightedId;
            const color = highlighted ? theme.text : theme.textSecondary;
            return (
              <Pressable
                key={item.id}
                testID={`preview-rail-item-${item.id}`}
                pointerEvents="none"
                onPress={() => selectA11y(item)}
                accessibilityRole="button"
                accessibilityLabel={item.ariaLabel}
                accessibilityState={{ selected: item.id === selectedId }}
                style={[styles.item, { height: itemSize }]}
              >
                {distance <= 2 ? (
                  <RailTick
                    scale={tickScale(distance)}
                    color={color}
                    reduceMotion={reduceMotion === true}
                  />
                ) : (
                  // tickScale(>=3) is constant 0.25 — a plain view avoids
                  // mounting a Reanimated node for every rail item.
                  <View
                    pointerEvents="none"
                    style={[
                      styles.tick,
                      { backgroundColor: color },
                      { transform: [{ scaleX: 0.25 }] },
                    ]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
      {previewItem ? (
        <View
          pointerEvents="none"
          testID="preview-rail-preview"
          style={[
            styles.previewWrap,
            {
              right: right + trackWidth + 4,
              top: Math.max(
                top,
                Math.min(
                  top +
                    stackTop +
                    highlightedIndex * itemSize +
                    itemSize / 2 -
                    PREVIEW_HEIGHT / 2,
                  top + railHeight - PREVIEW_HEIGHT,
                ),
              ),
            },
          ]}
        >
          <Glass style={styles.previewCard}>
            <Text
              style={[styles.previewTitle, { color: theme.text }]}
              numberOfLines={1}
            >
              {previewItem.label}
            </Text>
            {previewItem.description ? (
              <Text
                style={[styles.previewDesc, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {previewItem.description}
              </Text>
            ) : null}
          </Glass>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2,
  },
  rail: {
    position: 'absolute',
    zIndex: 3,
  },
  stack: {
    width: RAIL_WIDTH + RAIL_HIT_EXTRA,
    alignItems: 'flex-end',
  },
  item: {
    width: RAIL_WIDTH + RAIL_HIT_EXTRA,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  tick: {
    width: TICK_WIDTH,
    height: TICK_HEIGHT,
    borderRadius: 1,
    transformOrigin: 'right center',
  },
  previewWrap: {
    position: 'absolute',
    zIndex: 4,
    width: PREVIEW_WIDTH,
    maxWidth: '80%',
    height: PREVIEW_HEIGHT,
  },
  previewCard: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  previewTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  previewDesc: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
});
