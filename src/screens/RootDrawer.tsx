import React, {useCallback, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import PagerView, {
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import {KeyboardController} from 'react-native-keyboard-controller';
import {RecentsScreen} from './RecentsScreen';
import {ChatScreen, type ChatScreenRef} from './ChatScreen';
import {theme} from '../theme';


export function RootDrawer() {
  const pagerRef = useRef<PagerView>(null);
  const chatRef = useRef<ChatScreenRef>(null);

  const goToChat = () => pagerRef.current?.setPage(1);
  const goToRecents = () => pagerRef.current?.setPage(0);

  const onPageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    if (event.nativeEvent.position === 0) {
      KeyboardController.dismiss();
    }
  }, []);

  const newChat = () => {
    chatRef.current?.newChat();
    goToChat();
  };

  return (
    <View style={styles.root}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={1}
        onPageSelected={onPageSelected}>
        <View key="recents" style={styles.page}>
          <RecentsScreen onNewChat={newChat} />
        </View>
        <View key="chat" style={styles.page}>
          <ChatScreen ref={chatRef} onOpenRecents={goToRecents} />
        </View>
      </PagerView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
  },
  pager: {
    flex: 1,
    backgroundColor: theme.background,
  },
  page: {
    flex: 1,
  },
});
