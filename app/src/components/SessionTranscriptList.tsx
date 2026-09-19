// Isolated transcript list. KeyboardAwareLegendList is AnimatedLegendList +
// KeyboardChatScrollView SharedValues; keeping those hooks out of the giant
// ActiveSessionScreen (runtime, Sets) stops React Compiler + worklets 0.10.x
// from serializing that memo cache into a Release throw.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { type LegendListRef } from '@legendapp/list/react-native';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import { useReducedMotion } from 'react-native-reanimated';
import type { MessageEntry } from '../zeron/protocol/types';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';
import {
  clampComposerExtraHeight,
  composerExtraMax,
  composerListInset,
} from './composerExtraHeight';
import { WorkingStatusRow } from './WorkingStatus';
import { PreviewRail } from './agentsKit/PreviewRail';
import {
  buildRailItems,
  pickActiveRailId,
  type RailItem,
} from './agentsKit/messagePreview';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;
const RAIL_PADDING_RIGHT = 40;
const VIEWABILITY = { itemVisiblePercentThreshold: 40 };

export const WORKING_STATUS_ID = '__working-status__';

type TranscriptRow =
  | { kind: 'entry'; entry: MessageEntry }
  | { kind: 'working' };

export type SessionTranscriptListHandle = {
  scrollMessageToEnd: (opts: {
    animated: boolean;
    closeKeyboard: boolean;
  }) => Promise<void>;
  followEnd: (opts: {
    animated: boolean;
    closeKeyboard: boolean;
  }) => Promise<void>;
  noteSent: (entryCount: number) => void;
  onComposerLayout: (event: LayoutChangeEvent) => void;
};

export const SessionTranscriptList = forwardRef<
  SessionTranscriptListHandle,
  {
    entries: MessageEntry[];
    renderEntry: ({ item }: { item: MessageEntry }) => React.ReactElement;
    composerRef: React.RefObject<View | null>;
    contentMaxWidth?: number;
    windowWidth: number;
    windowHeight: number;
    insetsTop: number;
    insetsBottom: number;
    onComposerHeight: (height: number) => void;
    onShowScrollDown: (show: boolean) => void;
    /** `${chatId}:${openGeneration}` — changes on every thread open. */
    openKey: string;
    working?: boolean;
    chatId?: string;
    startedAt?: number;
  }
>(function SessionTranscriptListInner(
  {
    entries,
    renderEntry,
    composerRef,
    contentMaxWidth,
    windowWidth,
    windowHeight,
    insetsTop,
    insetsBottom,
    onComposerHeight,
    onShowScrollDown,
    openKey,
    working = false,
    chatId = '',
    startedAt = 0,
  },
  ref,
) {
  'use no memo';
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const listRef = useRef<LegendListRef>(null);
  const [following, setFollowing] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const [contentHeight, setContentHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [composerInset, setComposerInset] = useState(0);
  const [viewableIds, setViewableIds] = useState<string[]>([]);
  const [scrollMetrics, setScrollMetrics] = useState({
    offset: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });
  const [dismissKey, setDismissKey] = useState(0);
  const hasOverflowedRef = useRef(false);
  const scrolledForKeyRef = useRef<string | null>(null);
  const wasWorkingRef = useRef(working);
  const followingRef = useRef(following);
  followingRef.current = following;
  const viewableIdsRef = useRef<string[]>([]);

  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } =
    useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;
  const extraHeightRef = useRef(0);
  extraHeightRef.current = clampComposerExtraHeight(
    uiPrefsStore.getState().composerExtraHeight,
    composerExtraMax(windowHeight),
  );
  const baseHeightRef = useRef<number | null>(null);
  const lastMeasuredRef = useRef<number | null>(null);
  const onComposerHeightRef = useRef(onComposerHeight);
  onComposerHeightRef.current = onComposerHeight;
  const reportComposerInsetRef = useRef(reportComposerInset);
  reportComposerInsetRef.current = reportComposerInset;

  const data = useMemo((): TranscriptRow[] => {
    const rows: TranscriptRow[] = entries.map(entry => ({
      kind: 'entry',
      entry,
    }));
    if (working) rows.push({ kind: 'working' });
    return rows;
  }, [entries, working]);

  const railItems = useMemo(
    () =>
      buildRailItems(entries, {
        emptyLabel: t('session.message'),
        goToLabel: (role, n, total) =>
          t('session.goToMessage')
            .replace('{role}', role)
            .replace('{n}', String(n))
            .replace('{total}', String(total)),
      }),
    [entries],
  );
  const itemIds = useMemo(() => railItems.map(item => item.id), [railItems]);

  const overflowing = contentHeight > listHeight + 1 && entries.length > 1;
  const railTop = insetsTop + 96;
  const railHeight = Math.max(0, listHeight - railTop - composerInset);
  const columnWidth =
    contentMaxWidth !== undefined
      ? Math.min(contentMaxWidth, windowWidth)
      : windowWidth;
  const railRight = (windowWidth - columnWidth) / 2 + 4;
  const activeRailId = following
    ? itemIds[itemIds.length - 1] ?? ''
    : pickActiveRailId({
        itemIds,
        offset: scrollMetrics.offset,
        viewportHeight: scrollMetrics.viewportHeight || listHeight,
        contentHeight: scrollMetrics.contentHeight || contentHeight,
        viewableIds,
      });

  const publishInset = useCallback((extraHeight: number) => {
    const base = baseHeightRef.current;
    if (base === null) return;
    const extra = clampComposerExtraHeight(
      extraHeight,
      composerExtraMax(windowHeightRef.current),
    );
    const inset = composerListInset(base, extra);
    setComposerInset(inset);
    onComposerHeightRef.current(inset);
    reportComposerInsetRef.current({
      nativeEvent: { layout: { x: 0, y: 0, width: 0, height: inset } },
    } as LayoutChangeEvent);
  }, []);

  useEffect(
    () =>
      uiPrefsStore.subscribe((s, prev) => {
        if (s.composerExtraHeight === prev.composerExtraHeight) return;
        extraHeightRef.current = clampComposerExtraHeight(
          s.composerExtraHeight,
          composerExtraMax(windowHeightRef.current),
        );
        publishInset(s.composerExtraHeight);
      }),
    [publishInset],
  );

  useEffect(() => {
    if (entries.length === 0 && !working) return;
    if (scrolledForKeyRef.current === openKey) return;
    scrolledForKeyRef.current = openKey;
    hasOverflowedRef.current = true;
    setFollowing(true);
    scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(
      () => {},
    );
  }, [openKey, entries.length, working, scrollMessageToEnd]);

  useEffect(() => {
    const appeared = working && !wasWorkingRef.current;
    wasWorkingRef.current = working;
    if (!appeared || !followingRef.current) return;
    scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(
      () => {},
    );
  }, [working, scrollMessageToEnd]);

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const extra = extraHeightRef.current;
      const base = baseHeightRef.current;
      if (base !== null) {
        const expected = composerListInset(base, extra);
        if (height === expected) {
          lastMeasuredRef.current = height;
          publishInset(extra);
          return;
        }
        // Ignore a stale layout from before the extra-height write.
        if (
          lastMeasuredRef.current !== null &&
          height === lastMeasuredRef.current
        ) {
          return;
        }
      }
      baseHeightRef.current = height - extra;
      lastMeasuredRef.current = height;
      // Full sticky stack (chrome + composer). Extra height is applied as
      // base + extra so the transcript tracks the grabber 1:1 without
      // waiting for TextInput minHeight layout. Home/threads unchanged.
      publishInset(extra);
    },
    [publishInset],
  );

  const followEnd = useCallback(
    (opts: { animated: boolean; closeKeyboard: boolean }) => {
      hasOverflowedRef.current = true;
      setFollowing(true);
      return scrollMessageToEnd(opts);
    },
    [scrollMessageToEnd],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollMessageToEnd,
      followEnd,
      noteSent: (entryCount: number) => {
        setAnchorIndex(entryCount);
        if (hasOverflowedRef.current) {
          setFollowing(true);
        } else {
          setFollowing(false);
        }
      },
      onComposerLayout,
    }),
    [scrollMessageToEnd, followEnd, onComposerLayout],
  );

  const renderItem = useCallback(
    ({ item }: { item: TranscriptRow }) =>
      item.kind === 'working' ? (
        <WorkingStatusRow chatId={chatId} startedAt={startedAt} />
      ) : (
        renderEntry({ item: item.entry })
      ),
    [chatId, startedAt, renderEntry],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: TranscriptRow }> }) => {
      const ids = viewableItems
        .filter(v => v.item.kind === 'entry')
        .map(v => v.item.entry.id);
      const prev = viewableIdsRef.current;
      const same =
        ids.length === prev.length && ids.every((id, i) => id === prev[i]);
      if (same) return;
      viewableIdsRef.current = ids;
      setViewableIds(ids);
    },
  ).current;

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      setScrollMetrics({
        offset: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
        contentHeight: contentSize.height,
      });
    },
    [],
  );

  const scrollToRailItem = useCallback(
    (item: RailItem) => {
      const last = railItems[railItems.length - 1]?.id === item.id;
      if (last) {
        followEnd({
          animated: reduceMotion !== true,
          closeKeyboard: false,
        }).catch(() => {});
        return;
      }
      const index = entries.findIndex(entry => entry.id === item.id);
      if (index < 0) return;
      hasOverflowedRef.current = true;
      setFollowing(false);
      try {
        listRef.current?.scrollToIndex({
          index,
          animated: reduceMotion !== true,
          viewPosition: 0.5,
        });
      } catch {
        // LegendList throws if the row has not been measured yet.
      }
    },
    [entries, followEnd, railItems, reduceMotion],
  );

  return (
    <View
      testID="session-transcript"
      style={styles.fill}
      onLayout={event => {
        const height = event.nativeEvent.layout.height;
        setListHeight(prev => (prev === height ? prev : height));
      }}
    >
      <KeyboardAwareLegendList
        ref={listRef}
        style={styles.fill}
        data={data}
        keyExtractor={(item: TranscriptRow) =>
          item.kind === 'working' ? WORKING_STATUS_ID : item.entry.id
        }
        renderItem={renderItem}
        applyWorkaroundForContentInsetHitTestBug
        maintainVisibleContentPosition={
          Platform.OS !== 'android'
            ? undefined
            : anchorIndex != null && !following
        }
        keyboardLiftBehavior="whenAtEnd"
        keyboardOffset={insetsBottom}
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        freeze={freeze}
        anchoredEndSpace={
          anchorIndex != null
            ? {
                anchorIndex,
                anchorMaxSize: ANCHOR_MAX_SIZE,
                anchorOffset: insetsTop + 56,
                onSizeChanged: (size: number) => {
                  if (size <= 0 && !hasOverflowedRef.current) {
                    hasOverflowedRef.current = true;
                    setFollowing(true);
                  }
                },
              }
            : undefined
        }
        maintainScrollAtEnd={
          following ? { on: { dataChange: true, itemLayout: true } } : undefined
        }
        maintainScrollAtEndThreshold={1}
        estimatedItemSize={64}
        estimatedListSize={{ width: windowWidth, height: windowHeight }}
        onEndVisible={(v: boolean) => {
          onShowScrollDown(!v);
          if (v && hasOverflowedRef.current) setFollowing(true);
        }}
        onScrollBeginDrag={() => {
          if (hasOverflowedRef.current) setFollowing(false);
          setDismissKey(key => key + 1);
        }}
        onScroll={onScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        onContentSizeChange={(_w: number, height: number) => {
          setContentHeight(prev => (prev === height ? prev : height));
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insetsTop + 96 },
          overflowing ? { paddingRight: RAIL_PADDING_RIGHT } : undefined,
          contentMaxWidth !== undefined
            ? [styles.measureCap, { maxWidth: contentMaxWidth }]
            : undefined,
        ]}
        scrollIndicatorInsets={{ top: insetsTop + 96 }}
        showsVerticalScrollIndicator={!overflowing}
        keyboardDismissMode="interactive"
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.empty')}
          </Text>
        }
      />
      {overflowing && railItems.length > 1 && railHeight > 0 ? (
        <PreviewRail
          items={railItems}
          label={t('session.messageNavigation')}
          activeId={activeRailId}
          onItemSelect={scrollToRailItem}
          top={railTop}
          bottom={composerInset}
          right={railRight}
          railHeight={railHeight}
          dismissKey={dismissKey}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingBottom: 4 },
  empty: { fontSize: 15, textAlign: 'center', padding: 32 },
  measureCap: { width: '100%', alignSelf: 'center' },
});
