// Home (left pager page): search, spaces filter, the threads list driven by
// workspaceStore, archived shelf, connection pill. Settings sits next to
// the folder control; iPhone mounts the compose Composer here, iPad keeps
// a New thread button that enters detail compose.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import {
  LegendList,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DropdownMenu from 'zeego/dropdown-menu';
import * as ContextMenu from 'zeego/context-menu';
import { useStore } from 'zustand';
import {
  workspaceStore,
  useOverviewChats,
  useArchivedChats,
  useIndicator,
  useHostForChat,
} from '../zeron/state/workspaceStore';
import { chatUnseen } from '../zeron/doc/workspaceProjection';
import {
  isAgentRunning,
  sortOverviewThreads,
} from '../zeron/protocol/entities';
import {
  sessionTitle,
  hostLabel,
  checkoutLabel,
} from '../zeron/state/sessionTruth';
import {
  markChatSeen,
  renameChat,
  setChatArchived,
  deleteChat,
} from '../zeron/runtime/workspaceActions';
import { useRuntime } from '../app/runtimeContext';
import type { Chat } from '../zeron/protocol/types';
import { BrandMark } from '../components/BrandMark';
import { svgForHarness } from '../components/harnessBrand';
import { Glass, GlassContainer } from '../components/Glass';
import { Icon } from '../components/Icon';
import { ComposeComposer } from '../components/ComposeComposer';
import { useOverviewChangeRequestWatches } from '../hooks/useCheckoutWatches';
import { useThreadPrDot } from '../zeron/state/changeRequestStore';
import { setComposeDefaults } from '../zeron/state/uiPrefs';
import { useTheme, type Theme } from '../theme';
import { t } from '../i18n/strings';

const INACTIVE_OPACITY = 0.55;

const prDotColor = (
  theme: Theme,
  tone: 'draft' | 'open' | 'merged',
): string => {
  switch (tone) {
    case 'draft':
      return theme.prDraft;
    case 'open':
      return theme.prOpen;
    case 'merged':
      return theme.prMerged;
  }
};

export const relativeTime = (at: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(at).toLocaleDateString();
};

const ChatRow = React.memo(function ({
  chat,
  onOpen,
}: {
  chat: Chat;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const runtime = useRuntime();
  const indicator = useIndicator(chat.id);
  const host = useHostForChat(chat.id);
  const unseen = chatUnseen(chat);
  const prTone = useThreadPrDot(chat.id);
  const live = isAgentRunning(indicator);
  const [hovered, setHovered] = useState(false);
  const at = chat.lastMessageAt ?? chat.createdAt;
  const mark = svgForHarness(chat.config?.harness);

  const onRename = useCallback(() => {
    Alert.prompt(
      t('session.rename'),
      undefined,
      text => {
        if (text.trim() !== '' && runtime !== null)
          renameChat(runtime, chat.id, text.trim());
      },
      'plain-text',
      chat.title ?? '',
    );
  }, [runtime, chat.id, chat.title]);

  const onToggleArchive = useCallback(() => {
    if (runtime !== null) setChatArchived(runtime, chat.id, !chat.archived);
  }, [runtime, chat.id, chat.archived]);

  const onDelete = useCallback(() => {
    Alert.alert(t('home.row.delete'), t('home.row.deleteConfirm'), [
      { text: t('home.row.cancel'), style: 'cancel' },
      {
        text: t('home.row.deleteConfirmButton'),
        style: 'destructive',
        onPress: () => {
          if (runtime !== null) deleteChat(runtime, chat.id);
        },
      },
    ]);
  }, [runtime, chat.id]);

  const project = checkoutLabel(chat);
  const hostName = hostLabel(chat, host === undefined ? [] : [host]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Pressable
          style={[styles.row, hovered ? styles.rowHover : undefined]}
          onPress={() => {
            if (runtime !== null) markChatSeen(runtime, chat.id);
            onOpen(chat.id);
          }}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={[sessionTitle(chat), project, hostName]
            .filter(Boolean)
            .join(', ')}
        >
          {prTone !== null ? (
            <View
              style={[
                styles.dot,
                { backgroundColor: prDotColor(theme, prTone) },
              ]}
              testID={`pr-dot-${chat.id}-${prTone}`}
            />
          ) : (
            <View
              style={styles.dotPlaceholder}
              testID={`pr-dot-${chat.id}-none`}
            />
          )}
          <View
            style={[
              styles.rowText,
              live ? undefined : { opacity: INACTIVE_OPACITY },
            ]}
            testID={`thread-body-${chat.id}`}
          >
            <View style={styles.titleRow}>
              {mark !== undefined ? <BrandMark svg={mark} size={16} /> : null}
              <Text
                style={[
                  styles.title,
                  { color: theme.text },
                  unseen ? styles.unseen : undefined,
                ]}
                numberOfLines={1}
              >
                {sessionTitle(chat)}
              </Text>
            </View>
            <Text
              style={[styles.subtitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {[project, hostName, relativeTime(at, Date.now())]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {chat.lastMessagePreview !== undefined &&
            chat.lastMessagePreview !== '' ? (
              <Text
                style={[styles.preview, { color: theme.textSecondary }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.6}
              >
                {chat.lastMessagePreview}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item key="rename" onSelect={onRename}>
          <ContextMenu.ItemTitle>{t('home.row.rename')}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
        <ContextMenu.Item key="archive" onSelect={onToggleArchive}>
          <ContextMenu.ItemTitle>
            {chat.archived ? t('home.row.unarchive') : t('home.row.archive')}
          </ContextMenu.ItemTitle>
        </ContextMenu.Item>
        <ContextMenu.Item key="delete" destructive onSelect={onDelete}>
          <ContextMenu.ItemTitle>{t('home.row.delete')}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
});

export function HomeScreen({
  onOpenSession,
  onOpenSettings,
  onCompose,
  variant = 'screen',
}: {
  onOpenSession: (chatId: string) => void;
  onOpenSettings: () => void;
  /** iPad sidebar: enter compose in the detail column. */
  onCompose?: (opts?: { spaceId?: string }) => void;
  /** 'sidebar' renders inside the glass panel — its own New/Settings
   * controls switch from glass to subtle fills (no extra glass-on-glass). */
  variant?: 'screen' | 'sidebar';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Inside the glass sidebar the safe area is handled by the panel.
  const barInset = variant === 'sidebar' ? 0 : undefined;
  const control = (style: StyleProp<ViewStyle>, children: React.ReactNode) =>
    variant === 'sidebar' ? (
      <View style={[style, { backgroundColor: theme.inputBackground }]}>
        {children}
      </View>
    ) : (
      <Glass interactive style={style}>
        {children}
      </Glass>
    );
  const [query, setQuery] = useState('');
  const [spaceFilter, setSpaceFilter] = useState<string | undefined>(undefined);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [headerH, setHeaderH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const [composerH, setComposerH] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const runtime = useRuntime();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    runtime?.onForeground();
    setTimeout(() => setRefreshing(false), 600);
  }, [runtime]);

  const overview = useOverviewChats();
  const archived = useArchivedChats(spaceFilter);
  const spaces = useStore(workspaceStore, s => s.spaces);
  const devices = useStore(workspaceStore, s => s.devices);
  const connection = useStore(workspaceStore, s => s.connection);
  const sessions = useStore(workspaceStore, s => s.sessions);

  const chats = useMemo(() => {
    const scoped =
      spaceFilter === undefined
        ? overview
        : overview.filter(c => c.spaceId === spaceFilter);
    const q = query.trim().toLowerCase();
    const filtered =
      q === ''
        ? scoped
        : scoped.filter(c =>
            `${c.title ?? ''} ${c.lastMessagePreview ?? ''}`
              .toLowerCase()
              .includes(q),
          );
    return sortOverviewThreads(filtered, sessions, now);
  }, [overview, spaceFilter, query, sessions, now]);

  useOverviewChangeRequestWatches(runtime, chats);

  const spaceName = useCallback(
    (id: string) => spaces.find(s => s.id === id)?.name ?? id,
    [spaces],
  );

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<Chat>) => (
      <ChatRow chat={item} onOpen={onOpenSession} />
    ),
    [onOpenSession],
  );

  const folderLabel =
    spaceFilter === undefined ? t('home.allSpaces') : spaceName(spaceFilter);

  const enterCompose = useCallback(
    (spaceId?: string) => {
      if (spaceId !== undefined) {
        const space = spaces.find(s => s.id === spaceId);
        if (space !== undefined)
          setComposeDefaults({
            deviceId: space.deviceId,
            spaceId: space.id,
          });
      }
      onCompose?.({ spaceId });
    },
    [spaces, onCompose],
  );

  return (
    <View
      style={[
        styles.container,
        variant === 'sidebar'
          ? undefined
          : { backgroundColor: theme.background },
      ]}
    >
      <LegendList
        data={chats}
        keyExtractor={item => item.id}
        estimatedItemSize={66}
        recycleItems
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <Text style={[styles.section, { color: theme.textSecondary }]}>
            {t('home.sessions')}
          </Text>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('home.empty')}
          </Text>
        }
        ListFooterComponent={
          archived.length > 0 ? (
            <View>
              <Pressable
                style={styles.archivedHeader}
                onPress={() => setArchivedOpen(o => !o)}
                hitSlop={6}
              >
                <Icon name="archivebox" size={14} color={theme.textSecondary} />
                <Text style={[styles.section, { color: theme.textSecondary }]}>
                  {`${t('home.archived')} (${archived.length})`}
                </Text>
                <Icon
                  name={archivedOpen ? 'chevron.up' : 'chevron.down'}
                  size={12}
                  color={theme.textSecondary}
                />
              </Pressable>
              {archivedOpen
                ? archived.map(c => (
                    <ChatRow key={c.id} chat={c} onOpen={onOpenSession} />
                  ))
                : null}
            </View>
          ) : null
        }
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerH !== 0 ? headerH : insets.top + 64,
            paddingBottom:
              variant === 'sidebar'
                ? bottomH !== 0
                  ? bottomH + 12
                  : insets.bottom + 76
                : composerH !== 0
                ? composerH + 12
                : insets.bottom + 140,
          },
        ]}
        scrollIndicatorInsets={{
          top: headerH,
          bottom: variant === 'sidebar' ? bottomH : composerH,
        }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        renderItem={renderRow}
      />

      <View
        style={[styles.topBar, { paddingTop: (barInset ?? insets.top) + 8 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <GlassContainer spacing={8} style={styles.topRow}>
          <Glass interactive style={styles.search}>
            <Icon
              name="magnifyingglass"
              size={18}
              color={theme.textSecondary}
            />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder={t('home.search')}
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          </Glass>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Glass
                interactive
                style={styles.circle}
                accessibilityRole="button"
                accessibilityLabel={folderLabel}
                testID="spaceFilter"
              >
                <Icon
                  name={spaceFilter === undefined ? 'folder' : 'folder.fill'}
                  size={18}
                  color={theme.text}
                />
              </Glass>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item
                key="all"
                onSelect={() => setSpaceFilter(undefined)}
              >
                <DropdownMenu.ItemTitle>
                  {t('home.allSpaces')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              {spaceFilter !== undefined ? (
                <DropdownMenu.Item
                  key="newHere"
                  onSelect={() => enterCompose(spaceFilter)}
                >
                  <DropdownMenu.ItemTitle>
                    {`${t('home.newSessionIn')} ${spaceName(spaceFilter)}`}
                  </DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              ) : null}
              {devices.map(device => {
                const deviceSpaces = spaces.filter(
                  s => s.deviceId === device.id,
                );
                if (deviceSpaces.length === 0) return null;
                return (
                  <DropdownMenu.Group key={device.id}>
                    <DropdownMenu.Label>{device.name}</DropdownMenu.Label>
                    {deviceSpaces.map(s => (
                      <DropdownMenu.Item
                        key={s.id}
                        onSelect={() => setSpaceFilter(s.id)}
                      >
                        <DropdownMenu.ItemTitle>
                          {s.name ?? s.path}
                        </DropdownMenu.ItemTitle>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Group>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Pressable
            onPress={onOpenSettings}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('settings.title')}
            testID="home-settings"
          >
            <Glass interactive style={styles.circle}>
              <Icon name="gearshape" size={20} color={theme.text} />
            </Glass>
          </Pressable>
        </GlassContainer>

        {connection !== 'connected' ? (
          <View
            style={[styles.pill, { backgroundColor: theme.cardBackground }]}
          >
            <Text style={[styles.pillText, { color: theme.textSecondary }]}>
              {connection === 'connecting'
                ? t('home.connection.connecting')
                : t('home.connection.disconnected')}
            </Text>
          </View>
        ) : null}
      </View>

      {variant === 'sidebar' ? (
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: (barInset ?? insets.bottom) + 8 },
          ]}
          onLayout={e => setBottomH(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <Pressable
            style={styles.newChatWrap}
            onPress={() => enterCompose()}
            hitSlop={8}
            testID="home-new-thread"
            accessibilityRole="button"
            accessibilityLabel={t('home.newThread')}
          >
            {control(
              styles.newChat,
              <>
                <Icon name="plus" size={16} color={theme.text} />
                <Text style={[styles.newChatText, { color: theme.text }]}>
                  {t('home.newThread')}
                </Text>
              </>,
            )}
          </Pressable>
        </View>
      ) : (
        <View
          style={styles.homeComposer}
          onLayout={e => setComposerH(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <ComposeComposer sticky onCreated={onOpenSession} />
        </View>
      )}
    </View>
  );
}

const CIRCLE = 44;

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  searchInput: { flex: 1, fontSize: 17, padding: 0 },
  pill: {
    alignSelf: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 8,
  },
  pillText: { fontSize: 12, fontWeight: '500' },
  section: {
    fontSize: 16,
    fontWeight: '500',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  empty: { fontSize: 15, padding: 20, textAlign: 'center' },
  listContent: { paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 44,
  },
  rowHover: { opacity: 0.72 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotPlaceholder: { width: 8, height: 8 },
  rowText: { flex: 1, gap: 3 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '500' },
  unseen: { fontWeight: '700' },
  subtitle: { fontSize: 14 },
  preview: { fontSize: 13 },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  newChatWrap: { flex: 1 },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
  },
  newChatText: { fontSize: 17, fontWeight: '600' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  homeComposer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});
