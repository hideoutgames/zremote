// Two-page pager (the fork's RootDrawer shape): Home on the left, the open
// session on the right. Settings overlays as a sheet-like screen.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import { Freeze } from 'react-freeze';
import { KeyboardController } from 'react-native-keyboard-controller';
import { HomeScreen } from './HomeScreen';
import { SessionScreen } from './SessionScreen';
import { SettingsScreen } from './SettingsScreen';
import { useTheme } from '../theme';

const HOME_PAGE = 0;
const SESSION_PAGE = 1;

export function RootPager({ requestedChat }: { requestedChat: string | null }) {
  const theme = useTheme();
  const pagerRef = useRef<PagerView>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePage, setActivePage] = useState(HOME_PAGE);
  const [isIdle, setIsIdle] = useState(true);

  const goToSession = useCallback((id: string) => {
    setChatId(id);
    pagerRef.current?.setPage(SESSION_PAGE);
  }, []);
  const goHome = useCallback(() => pagerRef.current?.setPage(HOME_PAGE), []);

  useEffect(() => {
    if (requestedChat !== null) goToSession(requestedChat);
  }, [requestedChat, goToSession]);

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
        onPageSelected={onPageSelected}
        onPageScrollStateChanged={onPageScrollStateChanged}
      >
        <View key="home" style={styles.page}>
          <HomeScreen
            onOpenSession={goToSession}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </View>
        <View key="session" style={styles.page}>
          <Freeze freeze={isIdle && activePage !== SESSION_PAGE}>
            {chatId !== null ? (
              <SessionScreen chatId={chatId} onBack={goHome} />
            ) : (
              <View style={styles.page} />
            )}
          </Freeze>
        </View>
      </PagerView>
      {settingsOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pager: { flex: 1 },
  page: { flex: 1 },
});
