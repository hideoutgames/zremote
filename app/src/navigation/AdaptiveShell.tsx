// Adaptive navigation shell (JS — the UISplitViewController-backed container
// in modules/zeron-split-view is written but unverified, so this is what
// ships). Compact width keeps the Home↔Session pager; regular width (≥700pt)
// splits into Sidebar | Detail. The right inspector column is gone —
// History / Files / Terminal open from the session overflow as 75%
// SessionSheets (same chrome as View details).
//
// selectedChatId, sidebar collapse, inspector tab and drafts all live in this
// component (or the stores), so they survive size-class changes and rotation.
// SessionScreen stays mounted while columns toggle; it freezes only via the
// compact pager path. `useNativeSplitView` is intentionally false — flip only
// after the Mac verification checklist in docs/NATIVE_MODULES.md passes.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  setSidebarCollapsed,
  useSidebarCollapsed,
} from '../zeron/state/uiPrefs';
import { RootPager } from '../screens/RootPager';
import { HomeScreen } from '../screens/HomeScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AppErrorBoundary } from '../app/AppErrorBoundary';
import { useTheme } from '../theme';
import { NewThreadBackground } from '../components/NewThreadBackground';
import { Icon } from '../components/Icon';
import { layoutFor, type LayoutPrefs } from './layout';
import { t } from '../i18n/strings';

/** Flip only after the native split view is verified on a Mac
 *  (docs/NATIVE_MODULES.md). When true, swap the JS columns for
 *  `ZeronSplitView` from modules/zeron-split-view. */
export const USE_NATIVE_SPLIT_VIEW = false;

function InFlowSidebar({
  visible,
  width,
  borderColor,
  children,
}: {
  visible: boolean;
  width: number;
  borderColor: string;
  children: React.ReactNode;
}) {
  'use no memo';
  const reduceMotion = useReducedMotion();
  const collapse = useSharedValue(visible ? 0 : 1);
  useEffect(() => {
    const target = visible ? 0 : 1;
    collapse.value = reduceMotion
      ? target
      : withTiming(target, {
          duration: 280,
          easing: Easing.out(Easing.cubic),
        });
  }, [visible, reduceMotion, collapse]);
  const anim = useAnimatedStyle(() => ({
    width: (1 - collapse.value) * width,
  }));
  return (
    <Animated.View
      style={[styles.sidebarColumn, anim]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityState={{ expanded: visible }}
      accessibilityLabel={t('sidebar.toggle')}
      testID="threadsSidebar"
    >
      <View
        style={[styles.sidebarInner, { width, borderRightColor: borderColor }]}
      >
        {children}
      </View>
    </Animated.View>
  );
}

export function AdaptiveShell({
  requestedChat,
  onSelectedChat,
}: {
  requestedChat: string | null;
  onSelectedChat?: (chatId: string | undefined) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [chatId, setChatId] = useState<string | null>(null);
  const [openGeneration, setOpenGeneration] = useState(0);
  const [composing, setComposing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sidebarCollapsed = useSidebarCollapsed();

  useEffect(() => {
    if (requestedChat !== null) {
      setComposing(false);
      setChatId(requestedChat);
      setOpenGeneration(n => n + 1);
    }
  }, [requestedChat]);

  const prefs: LayoutPrefs = { sidebarCollapsed, inspectorOpen: false };
  const layout = layoutFor(width, prefs);

  useEffect(() => {
    if (layout.mode === 'compact') return;
    onSelectedChat?.(chatId ?? undefined);
  }, [layout.mode, chatId, onSelectedChat]);

  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [sidebarCollapsed],
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openSession = useCallback((id: string) => {
    setComposing(false);
    setChatId(id);
    setOpenGeneration(n => n + 1);
  }, []);
  const enterCompose = useCallback(() => {
    setChatId(null);
    setComposing(true);
  }, []);

  if (layout.mode === 'compact') {
    return (
      <RootPager
        requestedChat={requestedChat}
        onSelectedChat={onSelectedChat}
      />
    );
  }

  return (
    <View style={[styles.row, { backgroundColor: theme.background }]}>
      <NewThreadBackground />
      <InFlowSidebar
        visible={layout.sidebarVisible}
        width={layout.sidebarWidth}
        borderColor={theme.border}
      >
        <HomeScreen
          variant="sidebar"
          onOpenSession={openSession}
          onOpenSettings={openSettings}
          onCompose={enterCompose}
        />
      </InFlowSidebar>

      <View style={styles.detail}>
        {composing ? (
          <AppErrorBoundary resetKey="compose">
            <SessionScreen
              onBack={toggleSidebar}
              onCreated={openSession}
              leadingIcon="sidebar.left"
              contentMaxWidth={layout.measureCap}
              composerMaxWidth={layout.composerMaxWidth}
            />
          </AppErrorBoundary>
        ) : chatId !== null ? (
          <AppErrorBoundary resetKey={chatId}>
            <SessionScreen
              chatId={chatId}
              openGeneration={openGeneration}
              onBack={toggleSidebar}
              leadingIcon="sidebar.left"
              contentMaxWidth={layout.measureCap}
              composerMaxWidth={layout.composerMaxWidth}
            />
          </AppErrorBoundary>
        ) : (
          <View style={styles.emptyDetail}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              {t('session.empty')}
            </Text>
          </View>
        )}
      </View>

      {/* Settings as a native sheet (regular width → formSheet). */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        presentationStyle="formSheet"
        allowSwipeDismissal
        onRequestClose={() => setSettingsOpen(false)}
      >
        <SettingsScreen onClose={() => setSettingsOpen(false)} />
      </Modal>
    </View>
  );
}

// Header affordance used by compact mode too — exported for tests.
export function InspectorToggle({
  onPress,
  active,
}: {
  onPress: () => void;
  active: boolean;
}) {
  const theme = useTheme();
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('inspector.toggle')}
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={hover ? styles.hovered : undefined}
    >
      <Icon name="sidebar.right" size={18} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  sidebarColumn: {
    overflow: 'hidden',
  },
  sidebarInner: {
    flex: 1,
    paddingHorizontal: 20,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  detail: { flex: 1 },
  emptyDetail: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inspector: { borderLeftWidth: StyleSheet.hairlineWidth },
  tabs: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { minHeight: 44, justifyContent: 'center' },
  tabLabel: {},
  tabDisabled: { opacity: 0.5 },
  emptyText: {},
  hovered: { opacity: 0.7 },
});
