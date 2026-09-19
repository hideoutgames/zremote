// Codex-style message navigation rail. Semantics from beUI `preview-rail`
// (MIT) — compact ticks, hover/pin pyramid, floating destination preview.
// See docs/AGENTS_KIT_PROVENANCE.md.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Glass } from '../Glass';
import {
  RAIL_ITEM_SIZE,
  railItemSize,
  tickScale,
  type RailItem,
} from './messagePreview';

export type { RailItem as PreviewRailItem };

const RAIL_WIDTH = 28;
const TICK_WIDTH = 16;
const TICK_HEIGHT = StyleSheet.hairlineWidth < 1 ? 1 : StyleSheet.hairlineWidth;
const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 80;
const SPRING = { stiffness: 360, damping: 32, mass: 0.6 };

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
  onItemSelect: (item: RailItem) => void;
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

  useEffect(() => {
    setPinnedId(null);
  }, [dismissKey]);

  const selectedId = items.some(item => item.id === activeId)
    ? activeId
    : items[0]?.id ?? '';
  const highlightedId = pinnedId ?? selectedId;
  const highlightedIndex = items.findIndex(item => item.id === highlightedId);
  const itemSize = railItemSize(items.length, railHeight);
  const stackHeight = itemSize * items.length;
  const stackTop =
    items.length * RAIL_ITEM_SIZE <= railHeight
      ? Math.max(0, (railHeight - stackHeight) / 2)
      : 0;
  const previewItem = items.find(item => item.id === pinnedId);

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      testID="preview-rail"
      accessibilityLabel={label}
    >
      {pinnedId ? (
        <Pressable
          testID="preview-rail-dismiss"
          style={StyleSheet.absoluteFill}
          onPress={() => setPinnedId(null)}
          accessibilityRole="button"
          accessibilityLabel={label}
        />
      ) : null}
      <View
        pointerEvents="box-none"
        style={[styles.rail, { top, bottom, right, width: RAIL_WIDTH }]}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
      >
        <View
          pointerEvents="box-none"
          style={[styles.stack, { marginTop: stackTop }]}
        >
          {items.map((item, index) => {
            const distance =
              highlightedIndex < 0
                ? Number.POSITIVE_INFINITY
                : Math.abs(index - highlightedIndex);
            const highlighted = item.id === highlightedId;
            return (
              <Pressable
                key={item.id}
                testID={`preview-rail-item-${item.id}`}
                onPress={() => {
                  setPinnedId(item.id);
                  onItemSelect(item);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.ariaLabel}
                accessibilityState={{ selected: item.id === selectedId }}
                hitSlop={4}
                style={[styles.item, { height: itemSize }]}
              >
                <RailTick
                  scale={tickScale(distance)}
                  color={highlighted ? theme.text : theme.textSecondary}
                  reduceMotion={reduceMotion === true}
                />
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
              right: right + RAIL_WIDTH + 4,
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
    width: RAIL_WIDTH,
  },
  item: {
    width: RAIL_WIDTH,
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
