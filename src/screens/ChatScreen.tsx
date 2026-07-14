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
import {useChat, type Message} from '../hooks/useChat';
import {useAttachments} from '../hooks/useAttachments';
import {useHideBootSplashOnLayout} from '../hooks/useHideBootSplashOnLayout';
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
  const {messages, send, stop, newChat} = useChat();
  useImperativeHandle(ref, () => ({newChat}), [newChat]);
  const isStreaming = messages.some(m => m.status === 'streaming');
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const keyboardHeight = useKeyboardState(state => state.height);
  const keyboardDismissedForReplyRef = useRef(false);
  const [input, setInput] = useState('');
  const {attachments, pickImages, removeAttachment, clearAttachments} = useAttachments();
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

  // A message with an image is taller than the text cap, so capping it would
  // push its top (where the image sits) above the anchor offset and clip it.
  // Leave image messages uncapped so the top of the image lands at the offset.
  const anchorHasImage =
    anchorIndex != null &&
    (messages[anchorIndex]?.attachments?.length ?? 0) > 0;

  const {contentInsetEndAdjustment, onComposerLayout: reportComposerInset} = useKeyboardChatComposerInset(listRef, composerRef);
  const {freeze, scrollMessageToEnd} = useKeyboardScrollToEnd({listRef});

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setComposerHeight(event.nativeEvent.layout.height);
      reportComposerInset(event);
    },
    [reportComposerInset],
  );

  const onSend = useCallback(() => {
    if (!input.trim() && attachments.length === 0) {
      return;
    }
    const wasEmpty = messages.length === 0;
    setAnchorIndex(messages.length);
    send(input, attachments);
    setInput('');
    clearAttachments();
    keyboardDismissedForReplyRef.current = false;
    if (Platform.OS === 'ios') {
      scrollMessageToEnd({animated: true, closeKeyboard: false});
    } else if (!wasEmpty) {
      // Skip on the very first message: an animated scrollToEnd caused jitter on the first message.
      listRef.current?.scrollToEnd({animated: true});
    }
  }, [
    input,
    attachments,
    send,
    scrollMessageToEnd,
    clearAttachments,
    messages.length,
  ]);

  
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
      <KeyboardAwareLegendList
        ref={listRef}
        style={styles.fill}
        data={messages}
        keyExtractor={(item: Message) => item.id}
        renderItem={renderMessage}
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

      {messages.length === 0 ? (
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
          value={input}
          onChangeText={setInput}
          onSend={onSend}
          onStop={stop}
          streaming={isStreaming}
          attachments={attachments}
          onPickPhotos={pickImages}
          onRemoveAttachment={removeAttachment}
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
