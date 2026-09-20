// Isolated transcript list. FlashList + KeyboardChatScrollView SharedValues
// stay out of the giant ActiveSessionScreen (runtime, Sets) so React Compiler
// + worklets 0.10.x cannot serialize that memo cache into a Release throw.

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
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import type { MessageEntry } from '../zeron/protocol/types';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import { t } from '../i18n/strings';
import { transcriptHorizontalPadding } from '../navigation/layout';
import { useTheme } from '../theme';
import { ContentEdgeMask, COMPOSER_BOTTOM_FADE_BAND } from './TopChromeFade';
import {
  clampComposerExtraHeight,
  composerExtraMax,
  composerListInset,
} from './composerExtraHeight';
import { WorkingStatusBubble } from './WorkingStatus';
import { PreviewRail } from './agentsKit/PreviewRail';
import {
  buildRailItems,
  pickActiveRailId,
  type RailItem,
} from './agentsKit/messagePreview';
import { TranscriptChatScrollView } from './TranscriptChatScrollView';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;
export const RAIL_RIGHT = 4;
/** Remount FlashList after a sidebar-sized width jump so hit testing
 *  picks up the new column. Sub-delta ticks are ignored (no remount,
 *  no scroll restore) so a layout animation cannot remount the list
 *  several times in one collapse. */
export const LIST_RESIZE_REMOUNT_DELTA = 40;
const VIEWABILITY = { itemVisiblePercentThreshold: 40 };
export const END_THRESHOLD = 1;

export const listEndDistance = (
  contentHeight: number,
  offset: number,
  layoutHeight: number,
): number => contentHeight - offset - layoutHeight;

export const isTranscriptAtEnd = (
  distance: number,
  composerInset: number,
  threshold = END_THRESHOLD,
): boolean => distance + composerInset <= threshold;

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
    composerRef: _composerRef,
    contentMaxWidth,
    windowWidth: _windowWidth,
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
  const listRef = useRef<FlashListRef<TranscriptRow>>(null);
  const chatScrollRef =
    useRef<React.ComponentRef<typeof TranscriptChatScrollView>>(null);
  const [following, setFollowing] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const [contentHeight, setContentHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  const [composerInset, setComposerInset] = useState(0);
  const [viewableIds, setViewableIds] = useState<string[]>([]);
  const [scrollMetrics, setScrollMetrics] = useState({
    offset: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });
  const [dismissKey, setDismissKey] = useState(0);
  const [listHitKey, setListHitKey] = useState(0);
  const savedOffsetRef = useRef(0);
  const pendingRestoreRef = useRef<{
    offset: number;
    follow: boolean;
  } | null>(null);
  const hasOverflowedRef = useRef(false);
  const scrolledForKeyRef = useRef<string | null>(null);
  const wasWorkingRef = useRef(working);
  const followingRef = useRef(following);
  followingRef.current = following;
  const viewableIdsRef = useRef<string[]>([]);
  const atEndRef = useRef(false);
  const composerInsetRef = useRef(0);
  const lastDistanceRef = useRef(0);
  const scrollToEndRef = useRef<
    (opts: { animated: boolean; closeKeyboard: boolean }) => Promise<void>
  >(async () => {});
  const extraContentPadding = useSharedValue(0);
  const blankSpace = useSharedValue(0);
  const freeze = useSharedValue(false);

  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;
  const listHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const anchorIndexRef = useRef<number | undefined>(undefined);
  anchorIndexRef.current = anchorIndex;
  const anchorContentHeightRef = useRef(0);
  const extraHeightRef = useRef(0);
  extraHeightRef.current = clampComposerExtraHeight(
    uiPrefsStore.getState().composerExtraHeight,
    composerExtraMax(windowHeight),
  );
  const baseHeightRef = useRef<number | null>(null);
  const lastMeasuredRef = useRef<number | null>(null);
  const onComposerHeightRef = useRef(onComposerHeight);
  onComposerHeightRef.current = onComposerHeight;
  const onShowScrollDownRef = useRef(onShowScrollDown);
  onShowScrollDownRef.current = onShowScrollDown;

  const data = useMemo((): TranscriptRow[] => {
    const rows: TranscriptRow[] = entries.map(entry => ({
      kind: 'entry',
      entry,
    }));
    const last = entries[entries.length - 1];
    const workingInLastAssistant = working && last?.role === 'assistant';
    if (working && !workingInLastAssistant) rows.push({ kind: 'working' });
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
  const railRight = RAIL_RIGHT;
  const activeRailId = following
    ? itemIds[itemIds.length - 1] ?? ''
    : pickActiveRailId({
        itemIds,
        offset: scrollMetrics.offset,
        viewportHeight: scrollMetrics.viewportHeight || listHeight,
        contentHeight: scrollMetrics.contentHeight || contentHeight,
        viewableIds,
      });

  const publishInset = useCallback(
    (extraHeight: number) => {
      const base = baseHeightRef.current;
      if (base === null) return;
      const extra = clampComposerExtraHeight(
        extraHeight,
        composerExtraMax(windowHeightRef.current),
      );
      const inset = composerListInset(base, extra);
      const prev = composerInsetRef.current;
      composerInsetRef.current = inset;
      setComposerInset(inset);
      extraContentPadding.value = inset;
      onComposerHeightRef.current(inset);
      if (followingRef.current && prev !== inset) {
        scrollToEndRef
          .current({
            animated: false,
            closeKeyboard: false,
          })
          .catch(() => {});
      }
    },
    [extraContentPadding],
  );

  const scrollMessageToEnd = useCallback(
    async (opts: { animated: boolean; closeKeyboard: boolean }) => {
      freeze.set(true);
      const dismissPromise = opts.closeKeyboard
        ? KeyboardController.dismiss()
        : Promise.resolve();
      const scrollOpts = { animated: opts.animated };
      listRef.current?.scrollToEnd(scrollOpts);
      chatScrollRef.current?.scrollToEnd?.(scrollOpts);
      await dismissPromise;
      freeze.set(false);
    },
    [freeze],
  );
  scrollToEndRef.current = scrollMessageToEnd;

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

  const prevListWidthRef = useRef(0);
  useEffect(() => {
    const prev = prevListWidthRef.current;
    prevListWidthRef.current = listWidth;
    if (prev === 0 || listWidth === 0 || prev === listWidth) return;
    if (Math.abs(listWidth - prev) < LIST_RESIZE_REMOUNT_DELTA) return;
    pendingRestoreRef.current = {
      offset: savedOffsetRef.current,
      follow: followingRef.current,
    };
    setListHitKey(key => key + 1);
  }, [listWidth]);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (pending == null) return;
    pendingRestoreRef.current = null;
    const restore = () => {
      if (pending.follow) {
        scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(
          () => {},
        );
        return;
      }
      listRef.current?.scrollToOffset({
        offset: pending.offset,
        animated: false,
      });
    };
    requestAnimationFrame(restore);
  }, [listHitKey, listWidth, scrollMessageToEnd]);

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
        anchorContentHeightRef.current = contentHeightRef.current;
        const listH = listHeightRef.current || windowHeightRef.current;
        blankSpace.value = Math.max(0, listH - ANCHOR_MAX_SIZE);
        if (hasOverflowedRef.current) {
          setFollowing(true);
        } else {
          setFollowing(false);
        }
      },
      onComposerLayout,
    }),
    [blankSpace, scrollMessageToEnd, followEnd, onComposerLayout],
  );

  const renderItem = useCallback(
    ({ item }: { item: TranscriptRow }) =>
      item.kind === 'working' ? (
        <WorkingStatusBubble chatId={chatId} startedAt={startedAt} />
      ) : (
        renderEntry({ item: item.entry })
      ),
    [chatId, startedAt, renderEntry],
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: TranscriptRow }> }) => {
      const ids = viewableItems.flatMap(v =>
        v.item.kind === 'entry' ? [v.item.entry.id] : [],
      );
      const prev = viewableIdsRef.current;
      const same =
        ids.length === prev.length && ids.every((id, i) => id === prev[i]);
      if (same) return;
      viewableIdsRef.current = ids;
      setViewableIds(ids);
    },
  ).current;

  const applyEndVisible = useCallback((atEnd: boolean) => {
    if (atEnd === atEndRef.current) return;
    atEndRef.current = atEnd;
    onShowScrollDownRef.current(!atEnd);
    if (atEnd && hasOverflowedRef.current) setFollowing(true);
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      setScrollMetrics({
        offset: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
        contentHeight: contentSize.height,
      });
      savedOffsetRef.current = contentOffset.y;
      const distance = listEndDistance(
        contentSize.height,
        contentOffset.y,
        layoutMeasurement.height,
      );
      lastDistanceRef.current = distance;
      applyEndVisible(isTranscriptAtEnd(distance, composerInsetRef.current));
    },
    [applyEndVisible],
  );

  const updateBlankSpace = useCallback(
    (height: number) => {
      if (anchorIndexRef.current == null) {
        blankSpace.value = 0;
        return;
      }
      const listH = listHeightRef.current || windowHeightRef.current;
      const growth = Math.max(0, height - anchorContentHeightRef.current);
      const next = Math.max(0, listH - ANCHOR_MAX_SIZE - growth);
      blankSpace.value = next;
      if (next <= 0 && !hasOverflowedRef.current) {
        hasOverflowedRef.current = true;
        setFollowing(true);
      }
    },
    [blankSpace],
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
      const jump = listRef.current?.scrollToIndex({
        index,
        animated: reduceMotion !== true,
        viewPosition: 0.5,
      });
      jump?.catch(() => {
        // FlashList rejects if the row has not been measured yet.
      });
    },
    [entries, followEnd, railItems, reduceMotion],
  );

  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <TranscriptChatScrollView
        {...props}
        ref={chatScrollRef}
        extraContentPadding={extraContentPadding}
        blankSpace={blankSpace}
        freeze={freeze}
        offset={insetsBottom}
        onEndVisible={() =>
          applyEndVisible(
            isTranscriptAtEnd(
              lastDistanceRef.current,
              composerInsetRef.current,
            ),
          )
        }
      />
    ),
    [applyEndVisible, blankSpace, extraContentPadding, freeze, insetsBottom],
  );

  const maintainVisibleContentPosition = useMemo(
    () => ({
      startRenderingFromBottom: true,
      autoscrollToBottomThreshold: following ? END_THRESHOLD : undefined,
      animateAutoScrollToBottom: reduceMotion !== true,
    }),
    [following, reduceMotion],
  );

  return (
    <View
      testID="session-transcript"
      style={styles.fill}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        listHeightRef.current = height;
        setListHeight(prev => (prev === height ? prev : height));
        setListWidth(prev => (prev === width ? prev : width));
      }}
    >
      <ContentEdgeMask
        topInset={insetsTop + 58}
        bottomInset={composerInset}
        bottomBand={COMPOSER_BOTTOM_FADE_BAND}
      >
        <FlashList
          key={listHitKey}
          testID={`session-transcript-list-${listHitKey}`}
          ref={listRef}
          style={styles.fill}
          data={data}
          extraData={following}
          keyExtractor={(item: TranscriptRow) =>
            item.kind === 'working' ? WORKING_STATUS_ID : item.entry.id
          }
          getItemType={(item: TranscriptRow) =>
            item.kind === 'working' ? 'working' : item.entry.role
          }
          renderItem={renderItem}
          renderScrollComponent={renderScrollComponent}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          drawDistance={windowHeight}
          onScrollBeginDrag={() => {
            if (hasOverflowedRef.current) setFollowing(false);
            setDismissKey(key => key + 1);
          }}
          onScroll={onScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
          onContentSizeChange={(_w: number, height: number) => {
            const grew = height > contentHeightRef.current;
            contentHeightRef.current = height;
            setContentHeight(prev => (prev === height ? prev : height));
            updateBlankSpace(height);
            if (grew && followingRef.current) {
              scrollMessageToEnd({
                animated: false,
                closeKeyboard: false,
              }).catch(() => {});
            }
          }}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: insetsTop + 96,
              ...transcriptHorizontalPadding(listWidth, contentMaxWidth, 0),
            },
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
      </ContentEdgeMask>
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
});
