// Isolated transcript list. KeyboardAwareLegendList is AnimatedLegendList +
// KeyboardChatScrollView SharedValues; keeping those hooks out of the giant
// ActiveSessionScreen (runtime, Sets) stops React Compiler + worklets 0.10.x
// from serializing that memo cache into a Release throw.

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { type LegendListRef } from '@legendapp/list/react-native';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import type { MessageEntry } from '../zeron/protocol/types';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';

const ANCHOR_MAX_SIZE = 2 * 21 + 32;

export type SessionTranscriptListHandle = {
  scrollMessageToEnd: (opts: {
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
    extraHeight: number;
    composerRef: React.RefObject<View | null>;
    contentMaxWidth?: number;
    windowWidth: number;
    windowHeight: number;
    insetsTop: number;
    insetsBottom: number;
    onComposerHeight: (height: number) => void;
    onShowScrollDown: (show: boolean) => void;
  }
>(function SessionTranscriptListInner(
  {
    entries,
    renderEntry,
    extraHeight,
    composerRef,
    contentMaxWidth,
    windowWidth,
    windowHeight,
    insetsTop,
    insetsBottom,
    onComposerHeight,
    onShowScrollDown,
  },
  ref,
) {
  'use no memo';
  const theme = useTheme();
  const listRef = useRef<LegendListRef>(null);
  const [following, setFollowing] = useState(false);
  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);
  const hasOverflowedRef = useRef(false);

  const { contentInsetEndAdjustment, onComposerLayout: reportComposerInset } =
    useKeyboardChatComposerInset(listRef, composerRef);
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      onComposerHeight(height);
      reportComposerInset({
        ...event,
        nativeEvent: {
          ...event.nativeEvent,
          layout: {
            ...event.nativeEvent.layout,
            height: Math.max(0, height - extraHeight),
          },
        },
      });
    },
    [reportComposerInset, extraHeight, onComposerHeight],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollMessageToEnd,
      noteSent: (entryCount: number) => {
        setAnchorIndex(entryCount);
        hasOverflowedRef.current = false;
        setFollowing(false);
      },
      onComposerLayout,
    }),
    [scrollMessageToEnd, onComposerLayout],
  );

  return (
    <KeyboardAwareLegendList
      ref={listRef}
      style={styles.fill}
      data={entries}
      keyExtractor={(item: MessageEntry) => item.id}
      renderItem={renderEntry}
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
      }}
      contentContainerStyle={[
        styles.listContent,
        { paddingTop: insetsTop + 96 },
        contentMaxWidth !== undefined
          ? [styles.measureCap, { maxWidth: contentMaxWidth }]
          : undefined,
      ]}
      scrollIndicatorInsets={{ top: insetsTop + 96 }}
      keyboardDismissMode="interactive"
      ListEmptyComponent={
        <Text style={[styles.empty, { color: theme.textSecondary }]}>
          {t('session.empty')}
        </Text>
      }
    />
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingBottom: 4 },
  empty: { fontSize: 15, textAlign: 'center', padding: 32 },
  measureCap: { width: '100%', alignSelf: 'center' },
});
