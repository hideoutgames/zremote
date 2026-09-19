// Two-page pager (the fork's RootDrawer shape): Home on the left, the open
// session on the right. Settings overlays as a sheet-like screen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, StyleSheet, View } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import { Freeze } from 'react-freeze';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from './HomeScreen';
import { SessionScreen } from './SessionScreen';
import { SettingsScreen } from './SettingsScreen';
import { AppErrorBoundary } from '../app/AppErrorBoundary';
import { useTheme } from '../theme';
import {
  EDGE_BACK_WIDTH,
  isHorizontalEdgeMove,
  shouldCommitEdgeBack,
} from '../navigation/edgeBackGesture';

const HOME_PAGE = 0;
const SESSION_PAGE = 1;

export function RootPager({
  requestedChat,
  onSelectedChat,
}: {
  requestedChat: string | null;
  onSelectedChat?: (chatId: string | undefined) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = useState(HOME_PAGE);
  const [isIdle, setIsIdle] = useState(true);

  const goToSession = useCallback((id: string) => {
    setComposing(false);
    setChatId(id);
    setActivePage(SESSION_PAGE);
    pagerRef.current?.setPage?.(SESSION_PAGE);
  }, []);
  const goHome = useCallback(() => {
    setComposing(false);
    setActivePage(HOME_PAGE);
    pagerRef.current?.setPage?.(HOME_PAGE);
    KeyboardController.dismiss();
  }, []);
  const enterCompose = useCallback(() => {
    setChatId(null);
    setComposing(true);
    setActivePage(SESSION_PAGE);
    pagerRef.current?.setPage?.(SESSION_PAGE);
  }, []);
  const goHomeRef = useRef(goHome);
  goHomeRef.current = goHome;
  const edgePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => isHorizontalEdgeMove(g.dx, g.dy),
      onPanResponderRelease: (_e, g) => {
        if (shouldCommitEdgeBack(g.dx, g.vx)) goHomeRef.current();
      },
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  useEffect(() => {
    if (requestedChat !== null) goToSession(requestedChat);
  }, [requestedChat, goToSession]);

  useEffect(() => {
    onSelectedChat?.(
      activePage === SESSION_PAGE && !composing
        ? chatId ?? undefined
        : undefined,
    );
  }, [activePage, chatId, composing, onSelectedChat]);

  const onPageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const { position } = event.nativeEvent;
    setActivePage(position);
    if (position === HOME_PAGE) KeyboardController.dismiss();
  }, []);

  const onPageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      setIsIdle(event.nativeEvent.pageScrollState === 'idle');
    },
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={HOME_PAGE}
        scrollEnabled={false}
        onPageSelected={onPageSelected}
        onPageScrollStateChanged={onPageScrollStateChanged}
      >
        <View key="home" style={styles.page}>
          <HomeScreen
            onOpenSession={goToSession}
            onOpenSettings={() => setSettingsOpen(true)}
            onCompose={enterCompose}
          />
        </View>
        <View key="session" style={styles.page}>
          <Freeze freeze={isIdle && activePage !== SESSION_PAGE}>
            {composing ? (
              <AppErrorBoundary resetKey="compose">
                <SessionScreen onBack={goHome} onCreated={goToSession} />
              </AppErrorBoundary>
            ) : chatId !== null ? (
              <AppErrorBoundary resetKey={chatId}>
                <SessionScreen chatId={chatId} onBack={goHome} />
              </AppErrorBoundary>
            ) : (
              <View style={styles.page} />
            )}
          </Freeze>
        </View>
      </PagerView>
      {activePage === SESSION_PAGE ? (
        <View
          style={[
            styles.edgeStrip,
            { top: insets.top + 56, width: EDGE_BACK_WIDTH },
          ]}
          {...edgePan.panHandlers}
        />
      ) : null}
      {/* Settings as a native sheet (compact width → pageSheet). */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal
        onRequestClose={() => setSettingsOpen(false)}
      >
        <SettingsScreen onClose={() => setSettingsOpen(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
  edgeStrip: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
});
