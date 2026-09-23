// Full-width Liquid Glass completion card above the composer input —
// `/` commands + `$` skills + `@` files share the same surface (Zeron
// desktop `completion_card`/`completion_list`/`menu_row` port).
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useChromeTheme } from '../chromeTheme';
import { Glass } from './Glass';
import { Icon } from './Icon';

const CARD_RADIUS = 12;
const CARD_INSET = 4;
const MENU_GAP = 2;
const ROW_RADIUS = CARD_RADIUS - 1 - CARD_INSET;
const ROW_HEIGHT = 44;
const LIST_MAX_HEIGHT = 310;

export interface CompletionRowData {
  key: string;
  icon: SFSymbol;
  label: string;
  detail?: string;
}

export interface ComposerAutocompleteProps {
  /** Filter-ranked rows to render (empty while `loading` → skeleton). */
  rows: CompletionRowData[];
  /** Index into `rows` of the keyboard-highlighted row. */
  activeIndex: number | undefined;
  loading?: boolean;
  /** Error line rendered above rows/skeleton (danger tint). */
  error?: string;
  /** Empty-state line when nothing matches and nothing is loading. */
  emptyLabel: string;
  onPick: (index: number) => void;
  testID?: string;
}

function SkeletonRows() {
  const theme = useChromeTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [pulse, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0.6 : pulse.value,
  }));
  return (
    <View>
      {[0, 1, 2].map(i => (
        <Animated.View key={i} style={style}>
          <View style={styles.row}>
            <View
              style={[
                styles.skeletonIcon,
                { backgroundColor: theme.textSecondary },
              ]}
            />
            <View
              style={[
                styles.skeletonBar,
                { backgroundColor: theme.textSecondary },
                i === 2 ? styles.skeletonLast : styles.skeletonBarW,
              ]}
            />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

export function ComposerAutocomplete({
  rows,
  activeIndex,
  loading = false,
  error,
  emptyLabel,
  onPick,
  testID,
}: ComposerAutocompleteProps) {
  const theme = useChromeTheme();
  const listRef = useRef<ScrollView>(null);

  // Keep the keyboard-highlighted row inside the scrolled viewport.
  useEffect(() => {
    if (activeIndex === undefined) return;
    const y = Math.max(
      0,
      activeIndex * (ROW_HEIGHT + MENU_GAP) -
        (LIST_MAX_HEIGHT - ROW_HEIGHT) / 2,
    );
    listRef.current?.scrollTo({ y, animated: false });
  }, [activeIndex]);

  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !showSkeleton && rows.length === 0 && error === undefined;

  return (
    <View style={styles.wrap} testID={testID}>
      <Glass style={styles.card}>
        {error !== undefined ? (
          <Text style={[styles.notice, { color: theme.danger }]}>{error}</Text>
        ) : null}
        {showSkeleton ? (
          <SkeletonRows />
        ) : showEmpty ? (
          <Text style={[styles.notice, { color: theme.textSecondary }]}>
            {emptyLabel}
          </Text>
        ) : (
          <ScrollView
            ref={listRef}
            style={styles.list}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row, ix) => (
              <Pressable
                key={row.key}
                onPress={() => onPick(ix)}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                style={[
                  styles.row,
                  ix === activeIndex && {
                    backgroundColor: theme.assistantBubbleBackground,
                  },
                ]}
              >
                <View style={styles.iconWrap}>
                  <Icon name={row.icon} size={16} color={theme.textSecondary} />
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    { color: theme.text },
                    row.detail !== undefined ? styles.labelWithDetail : null,
                  ]}
                >
                  {row.label}
                </Text>
                {row.detail !== undefined && row.detail !== '' ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.detail, { color: theme.textSecondary }]}
                  >
                    {row.detail}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    paddingBottom: 6,
    zIndex: 10,
  },
  card: {
    borderRadius: CARD_RADIUS,
    padding: CARD_INSET,
    maxHeight: 320,
    overflow: 'hidden',
  },
  list: {
    maxHeight: LIST_MAX_HEIGHT,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: ROW_HEIGHT,
    borderRadius: ROW_RADIUS,
  },
  iconWrap: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 0,
    flexGrow: 1,
  },
  labelWithDetail: {
    flexGrow: 0,
    maxWidth: '55%',
  },
  detail: {
    fontSize: 12.5,
    flexShrink: 1,
    flexGrow: 1,
  },
  notice: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
  },
  skeletonIcon: {
    width: 16,
    height: 16,
    borderRadius: 4,
    opacity: 0.4,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 5,
    opacity: 0.3,
  },
  skeletonBarW: { width: '65%' },
  skeletonLast: { width: '40%' },
});
