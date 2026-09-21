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
import { NewThreadBackground } from '../components/NewThreadBackground';
import {
  EDGE_BACK_WIDTH,
  isHorizontalEdgeMove,
  shouldCommitEdgeBack,
} from '../navigation/edgeBackGesture';
import {
  HOME_PAGE,
  PAGER_SLIDE_MS,
  SESSION_PAGE,
  shouldFreezeSession,
} from '../navigation/pagerTransition';

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
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [openGeneration, setOpenGeneration] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = useState(HOME_PAGE);
  const [isIdle, setIsIdle] = useState(true);
  const [holdSession, setHoldSession] = useState(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const cancelSessionHold = useCallback(() => {
    clearHoldTimer();
    setHoldSession(false);
  }, [clearHoldTimer]);

  const releaseSessionHold = useCallback(() => {
    clearHoldTimer();
    setHoldSession(false);
    setComposing(false);
  }, [clearHoldTimer]);

  const goToSession = useCallback(
    (id: string) => {
      cancelSessionHold();
      setComposing(false);
      setChatId(id);
      setOpenGeneration(n => n + 1);
      setActivePage(SESSION_PAGE);
      pagerRef.current?.setPage?.(SESSION_PAGE);
    },
    [cancelSessionHold],
  );
  // pager-view v8 fires onPageSelected at SwiftUI selection change (animation
  // start). Hold the session painted until the reverse slide can finish.
  const goHome = useCallback(() => {
    setHoldSession(true);
    pagerRef.current?.setPage?.(HOME_PAGE);
    KeyboardController.dismiss();
    clearHoldTimer();
    holdTimerRef.current = setTimeout(releaseSessionHold, PAGER_SLIDE_MS);
  }, [clearHoldTimer, releaseSessionHold]);
  const enterCompose = useCallback(() => {
    cancelSessionHold();
    setChatId(null);
    setComposing(true);
    setActivePage(SESSION_PAGE);
    pagerRef.current?.setPage?.(SESSION_PAGE);
  }, [cancelSessionHold]);
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

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

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
      <NewThreadBackground />
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
          <Freeze freeze={shouldFreezeSession(isIdle, holdSession, activePage)}>
            {composing ? (
              <AppErrorBoundary resetKey="compose">
                <SessionScreen onBack={goHome} onCreated={goToSession} />
              </AppErrorBoundary>
            ) : chatId !== null ? (
              <AppErrorBoundary resetKey={chatId}>
                <SessionScreen
                  chatId={chatId}
                  openGeneration={openGeneration}
                  onBack={goHome}
                />
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
