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
import { sortOverviewThreads } from '../zeron/protocol/entities';
import {
  sessionTitle,
  hostLabel,
  checkoutLabel,
  threadStatusLine,
  type ThreadStatusLine,
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
import { usePrBadge } from '../zeron/state/changeRequestStore';
import {
  setComposeDefaults,
  toggleChatPinned,
  useChatPinned,
  usePinnedChatIds,
} from '../zeron/state/uiPrefs';
import { useTheme, type Theme } from '../theme';
import { t } from '../i18n/strings';

type HomeListItem =
  | { type: 'section'; id: string; title: string }
  | { type: 'chat'; chat: Chat };

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

const statusCopy = (line: ThreadStatusLine): string => {
  switch (line.kind) {
    case 'working':
      return t('session.working');
    case 'awaitingInput':
      return t('session.awaitingInput');
    case 'errored':
      return t('session.errored');
    case 'time':
      return line.label;
    case 'pr':
      return line.tone === 'merged'
        ? t('pr.merged')
        : line.tone === 'draft'
        ? t('pr.draft')
        : t('pr.open');
  }
};

const ThreadStatus = ({
  line,
  theme,
  chatId,
}: {
  line: ThreadStatusLine;
  theme: Theme;
  chatId: string;
}) => {
  const label = statusCopy(line);
  const showCounts =
    line.kind === 'pr' && (line.additions > 0 || line.deletions > 0);
  return (
    <Text
      style={[styles.subtitle, { color: theme.textSecondary }]}
      numberOfLines={1}
      maxFontSizeMultiplier={1.6}
      testID={`thread-status-${chatId}`}
    >
      {label}
      {showCounts && line.kind === 'pr' ? (
        <>
          {' · '}
          {line.additions > 0 ? (
            <Text
              style={{ color: theme.diffAddText }}
            >{`+${line.additions}`}</Text>
          ) : null}
          {line.additions > 0 && line.deletions > 0 ? ' ' : null}
          {line.deletions > 0 ? (
            <Text
              style={{ color: theme.diffDelText }}
            >{`\u2212${line.deletions}`}</Text>
          ) : null}
        </>
      ) : null}
    </Text>
  );
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
  const pr = usePrBadge(chat.id);
  const pinned = useChatPinned(chat.id);
  const [hovered, setHovered] = useState(false);
  const at = chat.lastMessageAt ?? chat.createdAt;
  const mark = svgForHarness(chat.config?.harness);
  const line = threadStatusLine(
    indicator,
    pr === undefined
      ? undefined
      : {
          tone: pr.tone,
          additions: pr.additions,
          deletions: pr.deletions,
        },
    relativeTime(at, Date.now()),
  );

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

  const onPin = useCallback(() => toggleChatPinned(chat.id), [chat.id]);

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
          style={[
            styles.row,
            { borderBottomColor: theme.border },
            hovered ? styles.rowHover : undefined,
          ]}
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
          <View style={styles.rowText} testID={`thread-body-${chat.id}`}>
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
            <ThreadStatus line={line} theme={theme} chatId={chat.id} />
          </View>
        </Pressable>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item key="rename" onSelect={onRename}>
          <ContextMenu.ItemTitle>{t('home.row.rename')}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
        <ContextMenu.Item key="pin" onSelect={onPin}>
          <ContextMenu.ItemTitle>
            {pinned ? t('session.unpin') : t('session.pin')}
          </ContextMenu.ItemTitle>
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [spaceFilter, setSpaceFilter] = useState<string | undefined>(undefined);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [headerH, setHeaderH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const [composerH, setComposerH] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const runtime = useRuntime();
  const searchExpanded = searchOpen || query.trim() !== '';

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
  const pinnedChatIds = usePinnedChatIds();

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

  const rows = useMemo(() => {
    const pinnedSet = new Set(pinnedChatIds);
    const pinned = pinnedChatIds
      .map(id => chats.find(c => c.id === id))
      .filter((c): c is Chat => c !== undefined);
    const rest = chats.filter(c => !pinnedSet.has(c.id));
    const items: HomeListItem[] = [];
    if (pinned.length > 0) {
      items.push({
        type: 'section',
        id: 'pinned',
        title: t('home.pinned'),
      });
      for (const c of pinned) items.push({ type: 'chat', chat: c });
    }
    for (const c of rest) items.push({ type: 'chat', chat: c });
    return items;
  }, [chats, pinnedChatIds]);

  useOverviewChangeRequestWatches(runtime, chats);

  const spaceName = useCallback(
    (id: string) => {
      const space = spaces.find(s => s.id === id);
      if (space === undefined) return id;
      if (space.name !== undefined && space.name !== '') return space.name;
      return space.path.split(/[\\/]/).filter(Boolean).pop() ?? id;
    },
    [spaces],
  );

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<HomeListItem>) => {
      if (item.type === 'section') {
        return (
          <Text style={[styles.section, { color: theme.textSecondary }]}>
            {item.title}
          </Text>
        );
      }
      return <ChatRow chat={item.chat} onOpen={onOpenSession} />;
    },
    [onOpenSession, theme.textSecondary],
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
        data={rows}
        keyExtractor={item =>
          item.type === 'section' ? `section:${item.id}` : item.chat.id
        }
        estimatedItemSize={78}
        recycleItems
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <Text style={[styles.largeTitle, { color: theme.text }]}>
            {spaceFilter === undefined
              ? t('home.sessions')
              : spaceName(spaceFilter)}
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
        renderItem={renderRow}
      />

      <View
        style={[styles.topBar, { paddingTop: (barInset ?? insets.top) + 8 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <GlassContainer spacing={8} style={styles.topRow}>
          {searchExpanded ? (
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
                onBlur={() => {
                  if (query.trim() === '') setSearchOpen(false);
                }}
                autoFocus
                autoCapitalize="none"
                accessibilityLabel={t('home.search')}
              />
            </Glass>
          ) : (
            <Pressable
              onPress={() => setSearchOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('home.search')}
              testID="home-search"
            >
              <Glass interactive style={styles.circle}>
                <Icon name="magnifyingglass" size={18} color={theme.text} />
              </Glass>
            </Pressable>
          )}
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
    justifyContent: 'flex-end',
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
  largeTitle: {
    fontSize: 34,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  section: {
    fontSize: 15,
    fontWeight: '500',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  empty: { fontSize: 15, padding: 20, textAlign: 'center' },
  listContent: { paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowHover: { opacity: 0.72 },
  rowText: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  unseen: { fontWeight: '700' },
  subtitle: { fontSize: 15 },
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
