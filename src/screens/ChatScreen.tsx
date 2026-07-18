import React, {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  type LayoutChangeEvent,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  KeyboardController,
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import {type LegendListRef} from '@legendapp/list/react-native';
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from '@legendapp/list/keyboard';
import {
  useChatStore,
  type Attachment,
  type Message,
} from '../state/chatStore';
import {useHideBootSplashOnLayout} from '../hooks/useHideBootSplashOnLayout';
import {ChatMessages} from '../components/ChatMessages';
import {MessageBubble} from '../components/MessageBubble';
import {
  ReasoningSheet,
  type ReasoningSheetRef,
} from '../components/ReasoningSheet';
import {Header} from '../components/Header';
import {Composer} from '../components/Composer';
import {EmptyState} from '../components/EmptyState';
import {ScrollToBottomButton} from '../components/ScrollToBottomButton';
import {theme} from '../theme';

// Cap for the anchored user bubble's reserved size (~2 lines + padding), per
// legend-list's AI-chat example.
const ANCHOR_MAX_SIZE = 2 * 21 + 32;

export type ChatScreenRef = {newChat: () => void};


type ChatScreenProps = {
  onOpenRecents: () => void;
  ref?: React.Ref<ChatScreenRef>;
};

export function ChatScreen({onOpenRecents, ref}: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const send = useChatStore(state => state.send);
  const stop = useChatStore(state => state.stop);
  const newChat = useChatStore(state => state.newChat);
  const messagesLength = useChatStore(state => state.messages.length);
  const isStreaming = useChatStore(state => state.isStreaming);
  useImperativeHandle(ref, () => ({newChat}), [newChat]);
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const keyboardHeight = useKeyboardState(state => state.height);
  const keyboardDismissedForReplyRef = useRef(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const reasoningSheetRef = useRef<ReasoningSheetRef>(null);

  const openReasoning = useCallback((reasoning: string) => {
    reasoningSheetRef.current?.present(reasoning);
  }, []);

  const renderMessage = useCallback(
    ({item}: {item: Message}) => (
      <MessageBubble message={item} onOpenReasoning={openReasoning} />
    ),
    [openReasoning],
  );

  const [anchorIndex, setAnchorIndex] = useState<number | undefined>(undefined);

  // Image messages are taller than the text cap; leave them uncapped so the top
  // of the image lands at the anchor offset instead of being clipped above it.
  const anchorHasImage = useChatStore(state =>
    anchorIndex != null
      ? (state.messages[anchorIndex]?.attachments?.length ?? 0) > 0
      : false,
  );

  const {contentInsetEndAdjustment, onComposerLayout: reportComposerInset} = useKeyboardChatComposerInset(listRef, composerRef);
  const {freeze, scrollMessageToEnd} = useKeyboardScrollToEnd({listRef});

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setComposerHeight(event.nativeEvent.layout.height);
      reportComposerInset(event);
    },
    [reportComposerInset],
  );

 
  const onSubmit = useCallback(
    (text: string, attachments: Attachment[]) => {
      const wasEmpty = messagesLength === 0;
      setAnchorIndex(messagesLength);
      send(text, attachments);
      keyboardDismissedForReplyRef.current = false;
      if (Platform.OS === 'ios') {
        scrollMessageToEnd({animated: true, closeKeyboard: false});
      } else if (!wasEmpty) {
        // Skip on the very first message: an animated scrollToEnd caused jitter on the first message.
        listRef.current?.scrollToEnd({animated: true});
      }
    },
    [messagesLength, send, scrollMessageToEnd],
  );

  
  const keyboardOffset = {opened: insets.bottom};

  // The chevron shows whenever the bottom of the conversation isn't visible.
  const onEndVisible = useCallback((visible: boolean) => {
    setShowScrollDown(!visible);
  }, []);

  const scrollToBottom = () => {
    scrollMessageToEnd({animated: true, closeKeyboard: false});
  };

  const onContainerLayout = useHideBootSplashOnLayout();

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      <ChatMessages>
        {messages => (
      <KeyboardAwareLegendList
        ref={listRef}
        style={styles.fill}
        data={messages}
        keyExtractor={(item: Message) => item.id}
        renderItem={renderMessage}
        // Let the bottom contentInset / anchored end-space area still catch scroll touches (RN 0.81+ hit-test bug, facebook/react-native#54123).
        applyWorkaroundForContentInsetHitTestBug
        // Android MVCP holds the anchor in place, but must be off while streaming or it blocks the reply from auto-scrolling.
        maintainVisibleContentPosition={
          Platform.OS === 'android' && !isStreaming 
        }
        keyboardLiftBehavior="whenAtEnd"
        // Match the composer's keyboard offset or a gap opens between the last message and the keyboard.
        keyboardOffset={insets.bottom}
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        freeze={freeze}
        anchoredEndSpace={
          anchorIndex != null
            ? {
                anchorIndex,
                anchorMaxSize: anchorHasImage ? undefined : ANCHOR_MAX_SIZE,
                anchorOffset: insets.top + 56,
                // Release the anchor once the reply fills the reserved space, so maintainScrollAtEnd can take over following it.
              onSizeChanged: size => {
                  // close the keyboard before the streaming reply's tail would slip behind it.
                  if (
                    !keyboardDismissedForReplyRef.current &&
                    keyboardVisible &&
                    keyboardHeight > 0 &&
                    size <= keyboardHeight
                  ) {
                    keyboardDismissedForReplyRef.current = true;
                    KeyboardController.dismiss();
                  }
                  if (size <= 0) {
                    setAnchorIndex(undefined);
                    listRef.current?.scrollToEnd({animated: false});
                  }
                },
              }
            : undefined
        }
        maintainScrollAtEnd={
          anchorIndex == null 
            ? {on: {dataChange: true}}
            : undefined
        }
        // Default threshold is too tight for fast streaming and permanently stops the follow.
        maintainScrollAtEndThreshold={1}
        estimatedItemSize={64}
        estimatedListSize={{width: windowWidth, height: windowHeight}}
        onEndVisible={onEndVisible}
        contentContainerStyle={[
          styles.listContent,
          {paddingTop: insets.top + 56},
        ]}
        keyboardDismissMode="interactive"
          />
        )}
      </ChatMessages>

      {messagesLength === 0 ? (
        <EmptyState composerHeight={composerHeight} />
      ) : null}

      <Header onNewChat={newChat} onOpenRecents={onOpenRecents} />

      <KeyboardStickyView
        offset={keyboardOffset}
        style={[styles.scrollDown, {bottom: composerHeight + 10}]}
        pointerEvents="box-none">
        {showScrollDown ? (
          <ScrollToBottomButton onPress={scrollToBottom} />
        ) : null}
      </KeyboardStickyView>

      <KeyboardStickyView offset={keyboardOffset} style={styles.composer}>
        <Composer
          composerRef={composerRef}
          onLayout={onComposerLayout}
          onSubmit={onSubmit}
          onStop={stop}
          streaming={isStreaming}
        />
      </KeyboardStickyView>

      <ReasoningSheet ref={reasoningSheetRef} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  fill: {
    flex: 1,
  },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrollDown: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 4,
  },
});
