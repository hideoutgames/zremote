// Adaptive navigation shell (JS — the UISplitViewController-backed container
// in modules/zeron-split-view is written but unverified, so this is what
// ships). Compact width keeps the Home↔Session pager; regular width (≥700pt)
// splits into Sidebar | Detail | Inspector columns.
//
// selectedChatId, sidebar collapse, inspector tab and drafts all live in this
// component (or the stores), so they survive size-class changes and rotation.
// SessionScreen stays mounted while columns toggle; it freezes only via the
// compact pager path. `useNativeSplitView` is intentionally false — flip only
// after the Mac verification checklist in docs/NATIVE_MODULES.md passes.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { RootPager } from '../screens/RootPager';
import { HomeScreen } from '../screens/HomeScreen';
import { SessionScreen } from '../screens/SessionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ChangesScreen } from '../screens/ChangesScreen';
import { FilesScreen } from '../screens/FilesScreen';
import { TerminalScreen } from '../screens/TerminalScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { useTheme } from '../theme';
import { Icon } from '../components/Icon';
import { layoutFor, type LayoutPrefs } from './layout';
import { t } from '../i18n/strings';

/** Flip only after the native split view is verified on a Mac
 *  (docs/NATIVE_MODULES.md). When true, swap the JS columns for
 *  `ZeronSplitView` from modules/zeron-split-view. */
export const USE_NATIVE_SPLIT_VIEW = false;

type InspectorTab = 'changes' | 'files' | 'terminal' | 'history';

export function AdaptiveShell({
  requestedChat,
}: {
  requestedChat: string | null;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [chatId, setChatId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('changes');

  useEffect(() => {
    if (requestedChat !== null) setChatId(requestedChat);
  }, [requestedChat]);

  const prefs: LayoutPrefs = { sidebarCollapsed, inspectorOpen };
  const layout = layoutFor(width, prefs);

  const toggleSidebar = useCallback(() => setSidebarCollapsed(v => !v), []);
  const toggleInspector = useCallback(() => setInspectorOpen(v => !v), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  if (layout.mode === 'compact') {
    return <RootPager requestedChat={requestedChat} />;
  }

  return (
    <View style={[styles.row, { backgroundColor: theme.background }]}>
      {layout.sidebarVisible ? (
        <View
          style={[
            styles.sidebar,
            { width: layout.sidebarWidth, borderRightColor: theme.border },
          ]}
        >
          <HomeScreen onOpenSession={setChatId} onOpenSettings={openSettings} />
        </View>
      ) : null}

      <View style={styles.detail}>
        {chatId !== null ? (
          <SessionScreen
            chatId={chatId}
            onBack={toggleSidebar}
            leadingIcon="sidebar.left"
            contentMaxWidth={layout.measureCap}
            onToggleInspector={toggleInspector}
          />
        ) : (
          <View style={styles.emptyDetail}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              {t('session.empty')}
            </Text>
          </View>
        )}
      </View>

      {layout.inspectorVisible ? (
        <View
          style={[
            styles.inspector,
            { width: layout.inspectorWidth, borderLeftColor: theme.border },
          ]}
        >
          <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
            {(['changes', 'files', 'terminal', 'history'] as const).map(tab => {
              const label =
                tab === 'changes'
                  ? t('inspector.changes')
                  : tab === 'files'
                  ? t('inspector.files')
                  : tab === 'terminal'
                  ? t('inspector.terminal')
                  : t('inspector.history');
              return (
                <Pressable
                  key={tab}
                  onPress={() => setInspectorTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{
                    selected: inspectorTab === tab,
                  }}
                  style={styles.tab}
                  hitSlop={8}
                >
                  <Text
                    maxFontSizeMultiplier={1.6}
                    style={[
                      styles.tabLabel,
                      {
                        color: inspectorTab === tab ? theme.accent : theme.text,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {inspectorTab === 'changes' && chatId !== null ? (
            <ChangesScreen
              chatId={chatId}
              embedded
              onOpenHistory={() => setInspectorTab('history')}
            />
          ) : null}
          {inspectorTab === 'files' && chatId !== null ? (
            <FilesScreen chatId={chatId} embedded />
          ) : null}
          {inspectorTab === 'terminal' && chatId !== null ? (
            <TerminalScreen chatId={chatId} />
          ) : null}
          {inspectorTab === 'history' && chatId !== null ? (
            <HistoryScreen chatId={chatId} />
          ) : null}
          {chatId === null ? (
            <View style={styles.emptyDetail}>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                {t('inspector.noSession')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {settingsOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        </View>
      ) : null}
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
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth },
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
