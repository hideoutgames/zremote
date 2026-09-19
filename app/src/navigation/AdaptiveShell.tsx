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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from '../components/Glass';
import {
  setSidebarCollapsed,
  useSidebarCollapsed,
} from '../zeron/state/uiPrefs';
import { RootPager } from '../screens/RootPager';
import { HomeScreen } from '../screens/HomeScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTheme } from '../theme';
import { Icon } from '../components/Icon';
import { layoutFor, type LayoutPrefs } from './layout';
import { t } from '../i18n/strings';

/** Flip only after the native split view is verified on a Mac
 *  (docs/NATIVE_MODULES.md). When true, swap the JS columns for
 *  `ZeronSplitView` from modules/zeron-split-view. */
export const USE_NATIVE_SPLIT_VIEW = false;

export function AdaptiveShell({
  requestedChat,
  onSelectedChat,
}: {
  requestedChat: string | null;
  onSelectedChat?: (chatId: string | undefined) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [chatId, setChatId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sidebarCollapsed = useSidebarCollapsed();

  useEffect(() => {
    if (requestedChat !== null) {
      setComposing(false);
      setChatId(requestedChat);
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
  }, []);
  const enterCompose = useCallback(() => {
    setChatId(null);
    setComposing(true);
  }, []);

  // In-flow sidebar: collapse.value 0 = open (full width), 1 = closed (0).
  const reduceMotion = useReducedMotion();
  const collapse = useSharedValue(layout.sidebarVisible ? 0 : 1);
  useEffect(() => {
    const target = layout.sidebarVisible ? 0 : 1;
    collapse.value = reduceMotion
      ? target
      : withTiming(target, {
          duration: 280,
          easing: Easing.out(Easing.cubic),
        });
  }, [layout.sidebarVisible, reduceMotion, collapse]);

  const sidebarWidth = layout.sidebarWidth;
  const sidebarAnim = useAnimatedStyle(() => ({
    width: (1 - collapse.value) * sidebarWidth,
  }));

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
      <Animated.View
        style={[styles.sidebarColumn, sidebarAnim]}
        pointerEvents={layout.sidebarVisible ? 'auto' : 'none'}
        accessibilityState={{ expanded: layout.sidebarVisible }}
        accessibilityLabel={t('sidebar.toggle')}
        testID="threadsSidebar"
      >
        <View
          style={[
            styles.sidebarInner,
            {
              width: layout.sidebarWidth,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          <Glass style={styles.sidebarGlass}>
            <HomeScreen
              variant="sidebar"
              onOpenSession={openSession}
              onOpenSettings={openSettings}
              onCompose={enterCompose}
            />
          </Glass>
        </View>
      </Animated.View>

      <View style={styles.detail}>
        {composing ? (
          <SessionScreen
            onBack={toggleSidebar}
            onCreated={openSession}
            leadingIcon="sidebar.left"
            contentMaxWidth={layout.measureCap}
            composerMaxWidth={layout.composerMaxWidth}
          />
        ) : chatId !== null ? (
          <SessionScreen
            chatId={chatId}
            onBack={toggleSidebar}
            leadingIcon="sidebar.left"
            contentMaxWidth={layout.measureCap}
            composerMaxWidth={layout.composerMaxWidth}
          />
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
    paddingLeft: 12,
    paddingRight: 8,
  },
  sidebarGlass: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
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
