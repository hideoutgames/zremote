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
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  KeyboardController,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { MessageEntry } from '../zeron/protocol/types';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import { t } from '../i18n/strings';
import { transcriptHorizontalPadding } from '../navigation/layout';
import {
  ContentEdgeMask,
  CHAT_TOP_FADE_BAND,
  COMPOSER_BOTTOM_FADE_BAND,
  COMPOSER_FADE_LIFT,
  composerMaskBottomInset,
} from './TopChromeFade';
import {
  clampComposerExtraHeight,
  composerBaseHeightSV,
  composerExtraMax,
  composerInsetSV,
  rememberComposerInset,
  seedComposerInset,
} from './composerExtraHeight';
import { WorkingStatusBubble } from './WorkingStatus';
import {
  PreviewRail,
  type PreviewRailSelectOpts,
} from './agentsKit/PreviewRail';
import {
  buildRailItems,
  entryPreviewText,
  pickActiveRailId,
  type RailItem,
} from './agentsKit/messagePreview';
import { TranscriptChatScrollView } from './TranscriptChatScrollView';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;
export const RAIL_RIGHT = 4;
/** Ignore sub-delta width ticks (layout animation noise). A sidebar-sized
 *  jump re-anchors only when already following the live edge — FlashList
 *  stays mounted so collapse does not rebuild rows mid-slide. */
export const LIST_RESIZE_REMOUNT_DELTA = 40;
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

/** Visual tail. Composer padding is an iOS content inset, so the offset
 *  has to include it. Native scrollToEnd can also treat a still-zero frame
 *  as a horizontal list and leave Y at 0. */
export const transcriptEndOffset = (
  contentHeight: number,
  viewportHeight: number,
  composerInset: number,
): number => Math.max(0, contentHeight - viewportHeight + composerInset);

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

const SessionTranscriptListInner = forwardRef<
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
>(function SessionTranscriptListBody(
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
  const reduceMotion = useReducedMotion();
  const keyboardHeight = useKeyboardState(s => s.height);
  const listRef = useRef<FlashListRef<TranscriptRow>>(null);
  const chatScrollRef =
    useRef<React.ComponentRef<typeof TranscriptChatScrollView>>(null);
  const [following, setFollowing] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const [contentHeight, setContentHeight] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  const [composerInset, setComposerInset] = useState(seedComposerInset);
  // Rail highlight lives outside React state: scroll picks a new id almost
  // every frame, and the rail is the only consumer — a per-instance store
  // lets PreviewRail re-render alone instead of the whole transcript.
  const railIdStore = useRef(createStore<{ id: string }>(() => ({ id: '' })));
  const scrollMetricsRef = useRef({
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
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const pendingRailJumpRef = useRef<{
    index: number;
    animated: boolean;
    progress?: number;
  } | null>(null);
  const railJumpRafRef = useRef<number | null>(null);
  const followRafRef = useRef<number | null>(null);
  const followAnimRef = useRef(false);
  const flashScrollRef = useRef<
    React.Ref<React.ComponentRef<typeof TranscriptChatScrollView>> | undefined
  >(undefined);
  const atEndRef = useRef(false);
  const [initialInset] = useState(seedComposerInset);
  const extraContentPadding = useSharedValue(initialInset);
  const composerInsetRef = useRef(initialInset);
  const lastDistanceRef = useRef(0);
  const scrollToEndRef = useRef<
    (opts: { animated: boolean; closeKeyboard: boolean }) => Promise<void>
  >(async () => {});
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

  // Preview text is keyed by entry identity (stable across projections via
  // reuseById): streaming updates only re-collapse the rows that changed
  // instead of re-folding the whole transcript per doc update.
  const previewTextCache = useRef(new WeakMap<MessageEntry, string>());
  const previewText = useCallback((entry: MessageEntry): string => {
    const cached = previewTextCache.current.get(entry);
    if (cached !== undefined) return cached;
    const text = entryPreviewText(entry);
    previewTextCache.current.set(entry, text);
    return text;
  }, []);
  const railItems = useMemo(
    () =>
      buildRailItems(entries, {
        emptyLabel: t('session.message'),
        goToLabel: (role, n, total) =>
          t('session.goToMessage')
            .replace('{role}', role)
            .replace('{n}', String(n))
            .replace('{total}', String(total)),
        previewText,
      }),
    [entries, previewText],
  );
  const itemIds = useMemo(() => railItems.map(item => item.id), [railItems]);
  const itemIdsRef = useRef(itemIds);
  itemIdsRef.current = itemIds;

  // The rail highlight is the only render consumer of per-frame scroll data;
  // keep metrics in refs and re-render only when the picked id changes.
  const recomputeRailId = useCallback(() => {
    const m = scrollMetricsRef.current;
    const ids = itemIdsRef.current;
    const next = followingRef.current
      ? ids[ids.length - 1] ?? ''
      : pickActiveRailId({
          itemIds: ids,
          offset: m.offset,
          viewportHeight: m.viewportHeight || listHeightRef.current,
          contentHeight: m.contentHeight || contentHeightRef.current,
        });
    railIdStore.current.setState({ id: next });
  }, []);

  useEffect(() => {
    recomputeRailId();
  }, [itemIds, following, recomputeRailId]);

  const overflowing = contentHeight > listHeight + 1 && entries.length > 1;
  const railTop = insetsTop + 96;
  const railHeight = Math.max(0, listHeight - railTop - composerInset);
  const railRight = RAIL_RIGHT;

  const publishMeasuredInset = useCallback(
    (height: number) => {
      if (height <= 0) return;
      const extra = clampComposerExtraHeight(
        extraHeightRef.current,
        composerExtraMax(windowHeightRef.current),
      );
      extraHeightRef.current = extra;
      rememberComposerInset(height);
      composerBaseHeightSV.value = height - extra;
      composerInsetSV.value = height;
      extraContentPadding.value = height;
      const prev = composerInsetRef.current;
      composerInsetRef.current = height;
      setComposerInset(height);
      onComposerHeightRef.current(height);
      if (followingRef.current && prev !== height) {
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
      if (followRafRef.current != null) {
        cancelAnimationFrame(followRafRef.current);
        followRafRef.current = null;
      }
      freeze.set(true);
      const dismissPromise = opts.closeKeyboard
        ? KeyboardController.dismiss()
        : Promise.resolve();
      const contentH = contentHeightRef.current;
      const listH = listHeightRef.current;
      if (contentH > 0 && listH > 0) {
        const offset = transcriptEndOffset(
          contentH,
          listH,
          composerInsetRef.current,
        );
        listRef.current?.scrollToOffset({ offset, animated: opts.animated });
        chatScrollRef.current?.scrollTo?.({
          y: offset,
          animated: opts.animated,
        });
      } else {
        const scrollOpts = { animated: opts.animated };
        listRef.current?.scrollToEnd(scrollOpts);
        chatScrollRef.current?.scrollToEnd?.(scrollOpts);
      }
      await dismissPromise;
      freeze.set(false);
    },
    [freeze],
  );
  scrollToEndRef.current = scrollMessageToEnd;

  const scheduleFollowEnd = useCallback((animated: boolean) => {
    followAnimRef.current = animated;
    if (followRafRef.current != null) return;
    followRafRef.current = requestAnimationFrame(() => {
      followRafRef.current = null;
      if (!followingRef.current) return;
      scrollToEndRef
        .current({ animated: followAnimRef.current, closeKeyboard: false })
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    const seed = seedComposerInset();
    extraContentPadding.value = seed;
    composerInsetSV.value = seed;
    composerInsetRef.current = seed;
    onComposerHeightRef.current(seed);
  }, [extraContentPadding, openKey]);

  useEffect(() => {
    if (entries.length === 0 && !working) return;
    if (scrolledForKeyRef.current === openKey) return;
    if (composerInsetRef.current <= 0) return;
    scrolledForKeyRef.current = openKey;
    hasOverflowedRef.current = true;
    followingRef.current = true;
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
    if (!followingRef.current) return;
    scrollMessageToEnd({ animated: false, closeKeyboard: false }).catch(
      () => {},
    );
  }, [listWidth, scrollMessageToEnd]);

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      publishMeasuredInset(height);
    },
    [publishMeasuredInset],
  );

  const followEnd = useCallback(
    (opts: { animated: boolean; closeKeyboard: boolean }) => {
      hasOverflowedRef.current = true;
      followingRef.current = true;
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
          followingRef.current = true;
          setFollowing(true);
        } else {
          followingRef.current = false;
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

  const applyEndVisible = useCallback((atEnd: boolean) => {
    if (atEnd === atEndRef.current) return;
    atEndRef.current = atEnd;
    onShowScrollDownRef.current(!atEnd);
    if (atEnd && hasOverflowedRef.current) {
      followingRef.current = true;
      setFollowing(true);
    }
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      scrollMetricsRef.current = {
        offset: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
        contentHeight: contentSize.height,
      };
      recomputeRailId();
      const distance = listEndDistance(
        contentSize.height,
        contentOffset.y,
        layoutMeasurement.height,
      );
      lastDistanceRef.current = distance;
      applyEndVisible(isTranscriptAtEnd(distance, composerInsetRef.current));
    },
    [applyEndVisible, recomputeRailId],
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
        followingRef.current = true;
        setFollowing(true);
      }
    },
    [blankSpace],
  );

  const maxRailOffset = useCallback((): number => {
    return Math.max(0, contentHeightRef.current - listHeightRef.current);
  }, []);

  const offsetForRailIndex = useCallback(
    (index: number): number => {
      const count = entriesRef.current.length;
      const max = maxRailOffset();
      return count <= 1 ? 0 : (index / Math.max(1, count - 1)) * max;
    },
    [maxRailOffset],
  );

  const offsetForRailProgress = useCallback(
    (progress: number): number => {
      const clamped = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
      return clamped * maxRailOffset();
    },
    [maxRailOffset],
  );

  const scrollChatToOffset = useCallback(
    (offset: number, animated: boolean) => {
      listRef.current?.scrollToOffset({ offset, animated });
      chatScrollRef.current?.scrollTo?.({ y: offset, animated });
    },
    [],
  );

  const performRailJump = useCallback(
    (index: number, animated: boolean) => {
      const offset = offsetForRailIndex(index);
      // Proportional offset first so KeyboardChatScrollView moves even when
      // FlashList scrollToIndex no-ops on an unmeasured row. scrollToIndex
      // then refines to a centered item when layout exists.
      scrollChatToOffset(offset, animated);
      const jump = listRef.current?.scrollToIndex({
        index,
        animated,
        viewPosition: 0.5,
      });
      jump?.catch(() => {
        requestAnimationFrame(() => {
          const retry = listRef.current?.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0.5,
          });
          retry?.catch(() => {
            scrollChatToOffset(offset, false);
          });
        });
      });
    },
    [offsetForRailIndex, scrollChatToOffset],
  );

  const performRailScrub = useCallback(
    (progress: number) => {
      scrollChatToOffset(offsetForRailProgress(progress), false);
    },
    [offsetForRailProgress, scrollChatToOffset],
  );

  const flushPendingRailJump = useCallback(() => {
    const pending = pendingRailJumpRef.current;
    if (!pending || followingRef.current) return;
    if (!pending.animated) {
      if (railJumpRafRef.current != null) return;
      railJumpRafRef.current = requestAnimationFrame(() => {
        railJumpRafRef.current = null;
        const next = pendingRailJumpRef.current;
        pendingRailJumpRef.current = null;
        if (!next || followingRef.current) return;
        if (next.progress != null) {
          performRailScrub(next.progress);
          return;
        }
        performRailJump(next.index, next.animated);
      });
      return;
    }
    pendingRailJumpRef.current = null;
    performRailJump(pending.index, pending.animated);
  }, [performRailJump, performRailScrub]);

  useEffect(() => {
    if (following) {
      // Re-latching to the live edge makes any queued rail jump stale —
      // drop it so it cannot fire on a later unrelated scroll.
      pendingRailJumpRef.current = null;
      if (railJumpRafRef.current != null) {
        cancelAnimationFrame(railJumpRafRef.current);
        railJumpRafRef.current = null;
      }
      return;
    }
    flushPendingRailJump();
  }, [following, flushPendingRailJump]);

  useEffect(
    () => () => {
      if (railJumpRafRef.current != null) {
        cancelAnimationFrame(railJumpRafRef.current);
        railJumpRafRef.current = null;
      }
      if (followRafRef.current != null) {
        cancelAnimationFrame(followRafRef.current);
        followRafRef.current = null;
      }
    },
    [],
  );

  const scrollToRailItem = useCallback(
    (item: RailItem, opts?: PreviewRailSelectOpts) => {
      const animated = opts?.animated !== false && reduceMotion !== true;
      const last = railItems[railItems.length - 1]?.id === item.id;
      if (last) {
        pendingRailJumpRef.current = null;
        if (railJumpRafRef.current != null) {
          cancelAnimationFrame(railJumpRafRef.current);
          railJumpRafRef.current = null;
        }
        followEnd({
          animated,
          closeKeyboard: false,
        }).catch(() => {});
        return;
      }
      const index = entries.findIndex(entry => entry.id === item.id);
      if (index < 0) return;
      hasOverflowedRef.current = true;
      const wasFollowing = followingRef.current;
      if (wasFollowing) {
        followingRef.current = false;
        setFollowing(false);
      }
      pendingRailJumpRef.current = {
        index,
        animated,
        progress: animated ? undefined : opts?.progress,
      };
      if (!wasFollowing) flushPendingRailJump();
    },
    [entries, flushPendingRailJump, followEnd, railItems, reduceMotion],
  );

  const setScrollRef = useCallback(
    (node: React.ComponentRef<typeof TranscriptChatScrollView> | null) => {
      chatScrollRef.current = node;
      const outer = flashScrollRef.current;
      if (typeof outer === 'function') outer(node);
      else if (outer) outer.current = node;
    },
    [],
  );

  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => {
      const { ref: listRefOuter, ...rest } = props as ScrollViewProps & {
        ref?: React.Ref<React.ComponentRef<typeof TranscriptChatScrollView>>;
      };
      flashScrollRef.current = listRefOuter;
      return (
        <TranscriptChatScrollView
          {...rest}
          ref={setScrollRef}
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
      );
    },
    [
      applyEndVisible,
      blankSpace,
      extraContentPadding,
      freeze,
      insetsBottom,
      setScrollRef,
    ],
  );

  const onScrollBeginDrag = useCallback(() => {
    if (hasOverflowedRef.current) {
      followingRef.current = false;
      setFollowing(false);
    }
    if (followRafRef.current != null) {
      cancelAnimationFrame(followRafRef.current);
      followRafRef.current = null;
    }
    setDismissKey(key => key + 1);
  }, []);

  const onContentSizeChange = useCallback(
    (_w: number, height: number) => {
      const grew = height > contentHeightRef.current;
      contentHeightRef.current = height;
      setContentHeight(prev => (prev === height ? prev : height));
      updateBlankSpace(height);
      if (grew && followingRef.current) scheduleFollowEnd(false);
    },
    [scheduleFollowEnd, updateBlankSpace],
  );

  const contentContainerStyle = useMemo(
    () => [
      styles.listContent,
      {
        paddingTop: insetsTop + 96,
        ...transcriptHorizontalPadding(listWidth, contentMaxWidth, 0),
      },
    ],
    [contentMaxWidth, insetsTop, listWidth],
  );

  const scrollIndicatorInsets = useMemo(
    () => ({ top: insetsTop + 96 }),
    [insetsTop],
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
        topBand={CHAT_TOP_FADE_BAND}
        bottomInset={
          composerMaskBottomInset(keyboardHeight, insetsBottom) +
          COMPOSER_FADE_LIFT
        }
        bottomBand={COMPOSER_BOTTOM_FADE_BAND}
      >
        <FlashList
          testID="session-transcript-list"
          ref={listRef}
          style={styles.fill}
          data={data}
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
          onScrollBeginDrag={onScrollBeginDrag}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          contentContainerStyle={contentContainerStyle}
          scrollIndicatorInsets={scrollIndicatorInsets}
          showsVerticalScrollIndicator={!overflowing}
          keyboardDismissMode="interactive"
        />
      </ContentEdgeMask>
      {overflowing && railItems.length > 1 && railHeight > 0 ? (
        <RailHighlight
          store={railIdStore.current}
          items={railItems}
          label={t('session.messageNavigation')}
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

export const SessionTranscriptList = React.memo(SessionTranscriptListInner);

/** Subscribes to the rail's active id so scroll updates re-render only the
 *  rail, never the transcript list. */
const RailHighlight = React.memo(function RailHighlightInner({
  store,
  ...props
}: Omit<React.ComponentProps<typeof PreviewRail>, 'activeId'> & {
  store: StoreApi<{ id: string }>;
}) {
  const activeId = useStore(store, s => s.id);
  return <PreviewRail {...props} activeId={activeId} />;
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingBottom: 4 },
});
