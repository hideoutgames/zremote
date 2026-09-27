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
  Pressable,
  StyleSheet,
  Text,
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
import type { MessageEntry, MessagePart } from '../zeron/protocol/types';
import { uiPrefsStore } from '../zeron/state/uiPrefs';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';
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
  entryIndexForProgress,
  entryPreviewText,
  nearestIndex,
  pickActiveRailId,
  railTicksFor,
  type RailItem,
} from './agentsKit/messagePreview';
import { TranscriptChatScrollView } from './TranscriptChatScrollView';
import {
  rangeAround,
  sameRange,
  shiftRange,
  slicesForEntry,
  tailRange,
  type EntryRange,
} from './transcriptWindow';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;
export const RAIL_RIGHT = 4;
/** Ignore sub-delta width ticks (layout animation noise). A sidebar-sized
 *  jump re-anchors only when already following the live edge — FlashList
 *  stays mounted so collapse does not rebuild rows mid-slide. */
export const LIST_RESIZE_REMOUNT_DELTA = 40;
export const END_THRESHOLD = 1;
/**
 * FlashList multiplies this by the viewport. `1` means "within one full
 * screen of the bottom", so measuring the next row yanks the reader back
 * and a long thread never leaves the tail. A small fraction sticks only
 * when the tail is actually on screen.
 */
export const AUTOSCROLL_VIEWPORT_FRACTION = 0.12;

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
  | {
      kind: 'entry';
      key: string;
      entry: MessageEntry;
      parts: MessagePart[];
      showTail: boolean;
      continued: boolean;
    }
  | { kind: 'working'; key: string };

export type TranscriptRenderInfo = {
  item: MessageEntry;
  parts?: MessagePart[];
  showTail?: boolean;
  continued?: boolean;
};

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
    renderEntry: (info: TranscriptRenderInfo) => React.ReactElement;
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
  // Pinned windows slide with new messages. A drag or a jump into history
  // unpins so measurement and streaming cannot drag the reader along.
  const pinnedToTailRef = useRef(true);
  const [range, setRange] = useState<EntryRange>(() =>
    tailRange(entries.length),
  );
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const pendingRevealRef = useRef<{
    id: string;
    animated: boolean;
    viewPosition: number;
  } | null>(null);
  const pendingFollowRef = useRef<{
    animated: boolean;
    closeKeyboard: boolean;
  } | null>(null);
  const startGateRef = useRef(true);
  // onEndReached's "already fired" flag resets whenever `data` changes, so a
  // window shift that leaves the reader near the new tail would page the
  // rest of the thread in one cascade. Re-arm only after they leave the end.
  const endGateRef = useRef(true);
  const pendingRailJumpRef = useRef<{
    index: number;
    animated: boolean;
    progress?: number;
  } | null>(null);
  const railJumpRafRef = useRef<number | null>(null);
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
    const rows: TranscriptRow[] = [];
    const end = Math.min(range.end, entries.length);
    for (let i = range.start; i < end; i++) {
      const entry = entries[i];
      if (!entry) continue;
      for (const slice of slicesForEntry(entry)) {
        rows.push({
          kind: 'entry',
          key: slice.key,
          entry,
          parts: slice.parts,
          showTail: slice.showTail,
          continued: slice.continued,
        });
      }
    }
    const last = entries[entries.length - 1];
    const tailVisible = range.end >= entries.length && entries.length > 0;
    const workingInLastAssistant = working && last?.role === 'assistant';
    if (working && tailVisible && !workingInLastAssistant) {
      rows.push({ kind: 'working', key: WORKING_STATUS_ID });
    }
    return rows;
  }, [entries, range.start, range.end, working]);
  const dataRef = useRef(data);
  dataRef.current = data;

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
  const entryIndexById = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((entry, index) => map.set(entry.id, index));
    return map;
  }, [entries]);

  const overflowing = contentHeight > listHeight + 1 && entries.length > 1;
  const railTop = insetsTop + 96;
  const railHeight = Math.max(0, listHeight - railTop - composerInset);
  const railRight = RAIL_RIGHT;
  const railTicks = useMemo(
    () => railTicksFor(railItems, railHeight),
    [railItems, railHeight],
  );
  const railTickIndexes = useMemo(
    () => railTicks.map(item => entryIndexById.get(item.id) ?? 0),
    [railTicks, entryIndexById],
  );
  const railTicksRef = useRef(railTicks);
  railTicksRef.current = railTicks;
  const railTickIndexesRef = useRef(railTickIndexes);
  railTickIndexesRef.current = railTickIndexes;

  // The rail highlight is the only render consumer of per-frame scroll data;
  // keep metrics in refs and re-render only when the picked id changes.
  // Scroll position is within the mounted window, then mapped onto the
  // (possibly sampled) ticks that represent the whole thread.
  const recomputeRailId = useCallback(() => {
    const ticks = railTicksRef.current;
    if (ticks.length === 0) {
      railIdStore.current.setState({ id: '' });
      return;
    }
    if (followingRef.current) {
      railIdStore.current.setState({ id: ticks[ticks.length - 1]?.id ?? '' });
      return;
    }
    const entriesNow = entriesRef.current;
    const rangeNow = rangeRef.current;
    const spanIds: string[] = [];
    const end = Math.min(rangeNow.end, entriesNow.length);
    for (let i = rangeNow.start; i < end; i++) {
      const id = entriesNow[i]?.id;
      if (id) spanIds.push(id);
    }
    const m = scrollMetricsRef.current;
    const localId = pickActiveRailId({
      itemIds: spanIds,
      offset: m.offset,
      viewportHeight: m.viewportHeight || listHeightRef.current,
      contentHeight: m.contentHeight || contentHeightRef.current,
    });
    const local = Math.max(0, spanIds.indexOf(localId));
    const absolute = rangeNow.start + (spanIds.length > 0 ? local : 0);
    const tickAt = nearestIndex(railTickIndexesRef.current, absolute);
    railIdStore.current.setState({ id: ticks[tickAt]?.id ?? '' });
  }, []);

  useEffect(() => {
    recomputeRailId();
  }, [
    railTicks,
    railTickIndexes,
    range.start,
    range.end,
    following,
    recomputeRailId,
  ]);

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

  useEffect(() => {
    const seed = seedComposerInset();
    extraContentPadding.value = seed;
    composerInsetSV.value = seed;
    composerInsetRef.current = seed;
    onComposerHeightRef.current(seed);
  }, [extraContentPadding, openKey]);

  useEffect(() => {
    pinnedToTailRef.current = true;
    startGateRef.current = true;
    endGateRef.current = true;
    pendingRevealRef.current = null;
    pendingFollowRef.current = null;
    setRange(prev => {
      const next = tailRange(entriesRef.current.length);
      return sameRange(prev, next) ? prev : next;
    });
  }, [openKey]);

  useEffect(() => {
    setRange(prev => {
      const count = entries.length;
      if (pinnedToTailRef.current) {
        const next = tailRange(count);
        return sameRange(prev, next) ? prev : next;
      }
      const start = Math.min(prev.start, count);
      const end = Math.min(count, Math.max(start, prev.end));
      const next = { start, end };
      return sameRange(prev, next) ? prev : next;
    });
  }, [entries.length]);

  useEffect(() => {
    if (range.end < entries.length) onShowScrollDownRef.current(true);
  }, [range.end, entries.length]);

  useEffect(() => {
    if (entries.length === 0 && !working) return;
    if (scrolledForKeyRef.current === openKey) return;
    if (composerInsetRef.current <= 0) return;
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
      pinnedToTailRef.current = true;
      pendingRevealRef.current = null;
      setFollowing(true);
      const next = tailRange(entriesRef.current.length);
      if (!sameRange(rangeRef.current, next)) {
        pendingFollowRef.current = opts;
        setRange(next);
        return Promise.resolve();
      }
      return scrollMessageToEnd(opts);
    },
    [scrollMessageToEnd],
  );

  useEffect(() => {
    const opts = pendingFollowRef.current;
    if (!opts) return;
    pendingFollowRef.current = null;
    scrollMessageToEnd(opts).catch(() => {});
  }, [data, scrollMessageToEnd]);

  useImperativeHandle(
    ref,
    () => ({
      scrollMessageToEnd,
      followEnd,
      noteSent: (entryCount: number) => {
        pinnedToTailRef.current = true;
        setAnchorIndex(entryCount);
        anchorContentHeightRef.current = contentHeightRef.current;
        const listH = listHeightRef.current || windowHeightRef.current;
        blankSpace.value = Math.max(0, listH - ANCHOR_MAX_SIZE);
        setRange(prev => {
          const next = tailRange(entriesRef.current.length);
          return sameRange(prev, next) ? prev : next;
        });
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
        renderEntry({
          item: item.entry,
          parts: item.parts,
          showTail: item.showTail,
          continued: item.continued,
        })
      ),
    [chatId, startedAt, renderEntry],
  );

  const applyEndVisible = useCallback((atEnd: boolean) => {
    if (atEnd === atEndRef.current) return;
    atEndRef.current = atEnd;
    const atThreadTail = rangeRef.current.end >= entriesRef.current.length;
    onShowScrollDownRef.current(!(atEnd && atThreadTail));
    if (atEnd && atThreadTail && hasOverflowedRef.current) {
      pinnedToTailRef.current = true;
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
      if (contentOffset.y > 48) startGateRef.current = true;
      recomputeRailId();
      const distance = listEndDistance(
        contentSize.height,
        contentOffset.y,
        layoutMeasurement.height,
      );
      // Half a viewport is past FlashList's 0.35 end threshold, so re-arming
      // here cannot chain another page in the same commit.
      if (distance > layoutMeasurement.height * 0.5) {
        endGateRef.current = true;
      }
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

  const coversFullThread = useCallback((): boolean => {
    const count = entriesRef.current.length;
    const current = rangeRef.current;
    return current.start <= 0 && current.end >= count;
  }, []);

  const proportionalNav = useCallback(
    (): boolean =>
      coversFullThread() &&
      railTicksRef.current.length >= entriesRef.current.length,
    [coversFullThread],
  );

  const rowIndexForEntry = useCallback((entryId: string): number => {
    return dataRef.current.findIndex(
      row => row.kind === 'entry' && row.entry.id === entryId,
    );
  }, []);

  const scrollRowTo = useCallback(
    (row: number, animated: boolean, viewPosition = 0.15) => {
      const jump = listRef.current?.scrollToIndex({
        index: row,
        animated,
        viewPosition,
      });
      jump?.catch(() => {
        requestAnimationFrame(() => {
          listRef.current
            ?.scrollToIndex({ index: row, animated: false, viewPosition })
            ?.catch(() => {});
        });
      });
    },
    [],
  );

  const revealEntry = useCallback(
    (entryIndex: number, animated: boolean) => {
      const entriesNow = entriesRef.current;
      const count = entriesNow.length;
      if (count === 0) return;
      const index = Math.max(0, Math.min(count - 1, entryIndex));
      if (index >= count - 1) {
        followEnd({ animated, closeKeyboard: false }).catch(() => {});
        return;
      }
      hasOverflowedRef.current = true;
      pinnedToTailRef.current = false;
      followingRef.current = false;
      setFollowing(false);
      const id = entriesNow[index]?.id;
      if (!id) return;
      const current = rangeRef.current;
      if (index >= current.start && index < current.end) {
        const row = rowIndexForEntry(id);
        if (row >= 0) scrollRowTo(row, animated);
        return;
      }
      pendingRevealRef.current = { id, animated, viewPosition: 0.15 };
      const next = rangeAround(index, count);
      setRange(prev => (sameRange(prev, next) ? prev : next));
    },
    [followEnd, rowIndexForEntry, scrollRowTo],
  );

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const row = data.findIndex(
      item => item.kind === 'entry' && item.entry.id === pending.id,
    );
    if (row < 0) return;
    pendingRevealRef.current = null;
    scrollRowTo(row, pending.animated, pending.viewPosition);
  }, [data, scrollRowTo]);

  const performRailJump = useCallback(
    (index: number, animated: boolean) => {
      const offset = offsetForRailIndex(index);
      // Proportional offset first so KeyboardChatScrollView moves even when
      // FlashList scrollToIndex no-ops on an unmeasured row. scrollToIndex
      // then refines to a centered item when layout exists. This path is
      // only for threads that fit in one window — a long thread jumps by
      // message index instead, because a proportional pixel offset lands
      // in the wrong place and fights scrollToIndex.
      scrollChatToOffset(offset, animated);
      const id = entriesRef.current[index]?.id;
      const row = id != null ? rowIndexForEntry(id) : -1;
      const target = row >= 0 ? row : index;
      const jump = listRef.current?.scrollToIndex({
        index: target,
        animated,
        viewPosition: 0.5,
      });
      jump?.catch(() => {
        requestAnimationFrame(() => {
          const retry = listRef.current?.scrollToIndex({
            index: target,
            animated: false,
            viewPosition: 0.5,
          });
          retry?.catch(() => {
            scrollChatToOffset(offset, false);
          });
        });
      });
    },
    [offsetForRailIndex, rowIndexForEntry, scrollChatToOffset],
  );

  const performRailScrub = useCallback(
    (progress: number) => {
      if (!proportionalNav()) {
        const count = entriesRef.current.length;
        const entryIndex = entryIndexForProgress(count, progress);
        const current = rangeRef.current;
        // Pixel offset inside the mounted window. scrollToIndex restarts its
        // measurement pass whenever the target moves, which makes a drag
        // scrub fight the list.
        if (
          entryIndex >= current.start &&
          entryIndex < current.end &&
          entryIndex < count - 1
        ) {
          const span = Math.max(1, current.end - current.start - 1);
          const local = (entryIndex - current.start) / span;
          hasOverflowedRef.current = true;
          pinnedToTailRef.current = false;
          if (followingRef.current) {
            followingRef.current = false;
            setFollowing(false);
          }
          scrollChatToOffset(local * maxRailOffset(), false);
          return;
        }
        revealEntry(entryIndex, false);
        return;
      }
      scrollChatToOffset(offsetForRailProgress(progress), false);
    },
    [
      maxRailOffset,
      offsetForRailProgress,
      revealEntry,
      scrollChatToOffset,
      proportionalNav,
    ],
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
      if (!proportionalNav()) {
        const count = entriesRef.current.length;
        const entryIndex =
          opts?.progress != null
            ? entryIndexForProgress(count, opts.progress)
            : entriesRef.current.findIndex(entry => entry.id === item.id);
        if (entryIndex < 0) return;
        if (!animated && opts?.progress != null) {
          hasOverflowedRef.current = true;
          const wasFollowing = followingRef.current;
          if (wasFollowing) {
            followingRef.current = false;
            setFollowing(false);
          }
          pendingRailJumpRef.current = {
            index: entryIndex,
            animated: false,
            progress: opts.progress,
          };
          if (!wasFollowing) flushPendingRailJump();
          return;
        }
        revealEntry(entryIndex, animated);
        return;
      }
      const index = entriesRef.current.findIndex(entry => entry.id === item.id);
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
    [
      flushPendingRailJump,
      followEnd,
      railItems,
      reduceMotion,
      revealEntry,
      proportionalNav,
    ],
  );

  const loadEarlier = useCallback(() => {
    const count = entriesRef.current.length;
    pinnedToTailRef.current = false;
    followingRef.current = false;
    setFollowing(false);
    hasOverflowedRef.current = true;
    startGateRef.current = false;
    const next = shiftRange(rangeRef.current, count, -1);
    if (sameRange(rangeRef.current, next)) return;
    const id = entriesRef.current[next.start]?.id;
    if (id) {
      pendingRevealRef.current = { id, animated: false, viewPosition: 0 };
    }
    setRange(next);
  }, []);

  const loadLater = useCallback(() => {
    const count = entriesRef.current.length;
    endGateRef.current = false;
    pinnedToTailRef.current = false;
    followingRef.current = false;
    setFollowing(false);
    const current = rangeRef.current;
    const next = shiftRange(current, count, 1);
    if (sameRange(current, next)) return;
    const anchor = Math.min(current.end, next.end - 1);
    const id = entriesRef.current[anchor]?.id;
    if (id) {
      pendingRevealRef.current = { id, animated: false, viewPosition: 0 };
    }
    setRange(next);
  }, []);

  const onStartReached = useCallback(() => {
    if (pinnedToTailRef.current || followingRef.current) return;
    if (!startGateRef.current) return;
    if (rangeRef.current.start <= 0) return;
    startGateRef.current = false;
    loadEarlier();
  }, [loadEarlier]);

  const onEndReached = useCallback(() => {
    if (!endGateRef.current) return;
    if (rangeRef.current.end >= entriesRef.current.length) return;
    loadLater();
  }, [loadLater]);

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
      autoscrollToBottomThreshold: following
        ? AUTOSCROLL_VIEWPORT_FRACTION
        : undefined,
      // Instant. An animated stick replays on every measured row and fights
      // the finger the moment a long thread starts to scroll.
      animateAutoScrollToBottom: false,
    }),
    [following],
  );

  const earlierLabel = t('session.earlierMessages');
  const laterLabel = t('session.laterMessages');

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
          keyExtractor={(item: TranscriptRow) => item.key}
          getItemType={(item: TranscriptRow) =>
            item.kind === 'working' ? 'working' : item.entry.role
          }
          renderItem={renderItem}
          renderScrollComponent={renderScrollComponent}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          drawDistance={windowHeight}
          ListHeaderComponent={
            range.start > 0 ? (
              <WindowEdge
                label={earlierLabel}
                testID="transcript-earlier"
                onPress={loadEarlier}
              />
            ) : null
          }
          ListFooterComponent={
            range.end < entries.length ? (
              <WindowEdge
                label={laterLabel}
                testID="transcript-later"
                onPress={loadLater}
              />
            ) : null
          }
          onStartReached={onStartReached}
          onStartReachedThreshold={0.35}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.35}
          onScrollBeginDrag={() => {
            pinnedToTailRef.current = false;
            // Same turn as onStartReached — the ref must drop before the
            // render that commits `following`, or the first drag never pages.
            if (hasOverflowedRef.current) {
              followingRef.current = false;
              setFollowing(false);
            }
            setDismissKey(key => key + 1);
          }}
          onScroll={onScroll}
          onContentSizeChange={(_w: number, height: number) => {
            contentHeightRef.current = height;
            setContentHeight(prev => (prev === height ? prev : height));
            updateBlankSpace(height);
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
        />
      </ContentEdgeMask>
      {overflowing && railTicks.length > 1 && railHeight > 0 ? (
        <RailHighlight
          store={railIdStore.current}
          items={railTicks}
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

function WindowEdge({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={styles.edge}
    >
      <Text style={[styles.edgeText, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingBottom: 4 },
  edge: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  edgeText: { fontSize: 13, fontWeight: '500' },
});
