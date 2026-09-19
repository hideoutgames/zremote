// Home (left pager page): search, spaces filter, the threads list driven by
// workspaceStore, archived shelf, connection pill. Settings sits next to
// the folder control. A right-aligned circular New thread button opens a
// blank chat (compact pager compose / regular detail compose).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  LegendList,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DropdownMenu from '../components/menus/dropdown-menu';
import * as ContextMenu from '../components/menus/context-menu';
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
import { HarnessMark } from '../components/HarnessMark';
import { Glass, GlassContainer, GlassControl } from '../components/Glass';
import { Icon } from '../components/Icon';
import { svgForPullRequest } from '../components/harnessBrand';
import { prToneColor } from '../components/prChrome';
import { ShimmerText } from '../components/ShimmerText';
import { formatWorkingElapsed } from '../zeron/state/workingElapsed';
import { useOverviewChangeRequestWatches } from '../hooks/useCheckoutWatches';
import {
  changeRequestStore,
  useThreadPrDot,
} from '../zeron/state/changeRequestStore';
import {
  setComposeDefaults,
  toggleChatPinned,
  useChatPinned,
  usePinnedChatIds,
} from '../zeron/state/uiPrefs';
import { partitionPinnedChats } from '../zeron/state/pinnedChats';
import { useTheme, type Theme } from '../theme';
import { t } from '../i18n/strings';
import { TopChromeFade } from '../components/TopChromeFade';

/** Extra list padding so the Threads title sits below the chrome fade. */
const LIST_GAP_BELOW_CHROME = 20;

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
  const live = line.kind === 'working' || line.kind === 'awaitingInput';
  const [width, setWidth] = useState(160);
  if (live) {
    return (
      <View
        testID={`thread-status-${chatId}`}
        onLayout={e => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0) setWidth(w);
        }}
      >
        <ShimmerText
          text={label}
          width={width}
          fontSize={15}
          fontWeight="500"
          maxLines={1}
          align="left"
          baseColor={theme.textSecondary}
          highlightColor={theme.text}
        />
      </View>
    );
  }
  if (line.kind === 'pr') {
    const prColor = prToneColor(theme, {
      tone: line.tone,
      state: line.tone === 'merged' ? 'merged' : 'open',
    });
    const showCounts = line.additions > 0 || line.deletions > 0;
    return (
      <View style={styles.prStatus} testID={`thread-status-${chatId}`}>
        <BrandMark svg={svgForPullRequest(prColor)} size={14} />
        <Text
          style={[
            styles.subtitle,
            styles.prStatusText,
            { color: theme.textSecondary },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
        >
          {label}
          {showCounts ? ' · ' : null}
          {showCounts && line.additions > 0 ? (
            <Text
              style={{ color: theme.diffAddText }}
            >{`+${line.additions}`}</Text>
          ) : null}
          {showCounts && line.additions > 0 && line.deletions > 0 ? ' ' : null}
          {showCounts && line.deletions > 0 ? (
            <Text
              style={{ color: theme.diffDelText }}
            >{`-${line.deletions}`}</Text>
          ) : null}
        </Text>
      </View>
    );
  }
  return (
    <Text
      style={[styles.subtitle, { color: theme.textSecondary }]}
      numberOfLines={1}
      maxFontSizeMultiplier={1.6}
      testID={`thread-status-${chatId}`}
    >
      {label}
    </Text>
  );
};

const ChatRow = React.memo(function ({
  chat,
  onOpen,
  now,
}: {
  chat: Chat;
  onOpen: (id: string) => void;
  now: number;
}) {
  const theme = useTheme();
  const runtime = useRuntime();
  const indicator = useIndicator(chat.id);
  const session = useStore(workspaceStore, s => s.sessions[chat.id]);
  const host = useHostForChat(chat.id);
  const unseen = chatUnseen(chat);
  const prTone = useThreadPrDot(chat.id);
  const prAdds = useStore(
    changeRequestStore,
    s => s.diffByChat[chat.id]?.additions ?? 0,
  );
  const prDels = useStore(
    changeRequestStore,
    s => s.diffByChat[chat.id]?.deletions ?? 0,
  );
  const pinned = useChatPinned(chat.id);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const suppressOpen = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const at = chat.lastMessageAt ?? chat.createdAt;
  const line = threadStatusLine(
    indicator,
    prTone === null
      ? undefined
      : { tone: prTone, additions: prAdds, deletions: prDels },
    relativeTime(at, now),
  );
  const workingStarted = session?.startedAt ?? session?.updatedAt;
  const workingElapsed =
    line.kind === 'working' && workingStarted !== undefined
      ? formatWorkingElapsed(workingStarted, now)
      : undefined;

  const armSuppress = useCallback(() => {
    suppressOpen.current = true;
    if (suppressTimer.current !== undefined) {
      clearTimeout(suppressTimer.current);
      suppressTimer.current = undefined;
    }
  }, []);

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (open) {
        armSuppress();
        return;
      }
      suppressTimer.current = setTimeout(() => {
        suppressOpen.current = false;
        suppressTimer.current = undefined;
      }, 100);
    },
    [armSuppress],
  );

  useEffect(
    () => () => {
      if (suppressTimer.current !== undefined)
        clearTimeout(suppressTimer.current);
    },
    [],
  );

  const onPin = useCallback(() => toggleChatPinned(chat.id), [chat.id]);

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
  const live = line.kind === 'working' || line.kind === 'awaitingInput';

  return (
    <ContextMenu.Root onOpenChange={onMenuOpenChange}>
      <ContextMenu.Trigger>
        <Pressable
          style={[
            styles.row,
            { borderBottomColor: theme.border },
            hovered && !menuOpen ? styles.rowHover : undefined,
            menuOpen
              ? [
                  styles.rowMenuOpen,
                  {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                    shadowColor: theme.scheme === 'dark' ? '#000' : '#111',
                  },
                ]
              : undefined,
          ]}
          onPress={() => {
            if (suppressOpen.current) return;
            if (runtime !== null) markChatSeen(runtime, chat.id);
            onOpen(chat.id);
          }}
          onLongPress={armSuppress}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          accessibilityRole="button"
          accessibilityLabel={[sessionTitle(chat), project, hostName]
            .filter(Boolean)
            .join(', ')}
        >
          <View style={styles.rowText} testID={`thread-body-${chat.id}`}>
            <View style={styles.titleRow}>
              <HarnessMark
                harnessId={chat.config?.harness}
                size={16}
                color={theme.text}
              />
              <Text
                style={[
                  styles.title,
                  { color: live ? theme.accent : theme.text },
                  unseen ? styles.unseen : undefined,
                ]}
                numberOfLines={1}
              >
                {sessionTitle(chat)}
              </Text>
              {pinned ? (
                <View testID={`thread-pin-${chat.id}`}>
                  <Icon name="pin.fill" size={12} color={theme.textSecondary} />
                </View>
              ) : null}
            </View>
            <ThreadStatus line={line} theme={theme} chatId={chat.id} />
          </View>
          {workingElapsed !== undefined ? (
            <Text
              style={[styles.elapsed, { color: theme.textSecondary }]}
              testID={`thread-elapsed-${chat.id}`}
            >
              {workingElapsed}
            </Text>
          ) : null}
        </Pressable>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Group>
          <ContextMenu.Item key="pin" onSelect={onPin}>
            <ContextMenu.ItemTitle>
              {pinned ? t('session.unpin') : t('session.pin')}
            </ContextMenu.ItemTitle>
            <ContextMenu.ItemIcon
              ios={{ name: pinned ? 'pin.slash' : 'pin' }}
            />
          </ContextMenu.Item>
        </ContextMenu.Group>
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
  /** Compact pager / iPad detail: enter a blank compose session. */
  onCompose?: (opts?: { spaceId?: string }) => void;
  /** 'sidebar' tightens top-bar padding; New thread is the same on both. */
  variant?: 'screen' | 'sidebar';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const [spaceFilter, setSpaceFilter] = useState<string | undefined>(undefined);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [headerH, setHeaderH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const runtime = useRuntime();
  const searching = searchFocused || query.trim() !== '';

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
  const pinnedIds = usePinnedChatIds();

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
  const { pinned, rest } = useMemo(
    () => partitionPinnedChats(chats, pinnedIds),
    [chats, pinnedIds],
  );

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
    ({ item }: LegendListRenderItemProps<Chat>) => (
      <ChatRow chat={item} onOpen={onOpenSession} now={now} />
    ),
    [onOpenSession, now],
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

  const folderMenu = (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Pressable
          style={styles.fill}
          accessibilityRole="button"
          accessibilityLabel={folderLabel}
          testID="spaceFilter"
        >
          <Icon
            name={spaceFilter === undefined ? 'folder' : 'folder.fill'}
            size={18}
            color={theme.text}
          />
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item key="all" onSelect={() => setSpaceFilter(undefined)}>
          <DropdownMenu.ItemTitle>{t('home.allSpaces')}</DropdownMenu.ItemTitle>
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
          const deviceSpaces = spaces.filter(s => s.deviceId === device.id);
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
  );
  const settingsBtn = (
    <Pressable
      onPress={onOpenSettings}
      style={styles.fill}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('settings.title')}
      testID="home-settings"
    >
      <Icon name="gearshape" size={20} color={theme.text} />
    </Pressable>
  );
  const trailing = (
    <>
      <Glass interactive style={styles.circle}>
        {folderMenu}
      </Glass>
      <Glass interactive style={styles.circle}>
        {settingsBtn}
      </Glass>
    </>
  );

  const bottomPad = searching
    ? insets.bottom + 12
    : bottomH !== 0
    ? bottomH + 12
    : insets.bottom + 76;
  const chromeH = headerH !== 0 ? headerH : insets.top + 64;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <LegendList
        data={rest}
        keyExtractor={item => item.id}
        estimatedItemSize={78}
        recycleItems
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <>
            <Text
              style={[styles.largeTitle, { color: theme.text }]}
              testID="home-title"
            >
              {spaceFilter === undefined
                ? t('home.sessions')
                : spaceName(spaceFilter)}
            </Text>
            {pinned.length > 0 ? (
              <View style={styles.pinnedSection} testID="home-pinned-section">
                <Text style={[styles.section, { color: theme.textSecondary }]}>
                  {t('home.pinned')}
                </Text>
                {pinned.map(c => (
                  <ChatRow
                    key={c.id}
                    chat={c}
                    onOpen={onOpenSession}
                    now={now}
                  />
                ))}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          pinned.length === 0 ? (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              {t('home.empty')}
            </Text>
          ) : null
        }
        ListFooterComponent={
          archived.length > 0 ? (
            <View>
              <Pressable
                style={styles.archivedHeader}
                onPress={() => setArchivedOpen(o => !o)}
                hitSlop={6}
                testID="home-archived-header"
              >
                <View style={styles.archivedIcon}>
                  <Icon
                    name="archivebox"
                    size={14}
                    color={theme.textSecondary}
                  />
                </View>
                <Text
                  style={[styles.archivedLabel, { color: theme.textSecondary }]}
                >
                  {`${t('home.archived')} (${archived.length})`}
                </Text>
                <View style={styles.archivedIcon}>
                  <Icon
                    name={archivedOpen ? 'chevron.up' : 'chevron.down'}
                    size={14}
                    color={theme.textSecondary}
                  />
                </View>
              </Pressable>
              {archivedOpen
                ? archived.map(c => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      onOpen={onOpenSession}
                      now={now}
                    />
                  ))
                : null}
            </View>
          ) : null
        }
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: chromeH + LIST_GAP_BELOW_CHROME,
            paddingBottom: bottomPad,
          },
        ]}
        scrollIndicatorInsets={{
          top: headerH,
          bottom: searching ? 0 : bottomH,
        }}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        renderItem={renderRow}
      />

      <TopChromeFade inset={chromeH} />

      <View
        style={[styles.topBar, { paddingTop: insets.top + 8 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.topRow,
            variant === 'sidebar' ? styles.topRowSidebar : undefined,
          ]}
        >
          <Glass interactive style={styles.search}>
            <Icon
              name="magnifyingglass"
              size={18}
              color={theme.textSecondary}
            />
            <TextInput
              ref={searchRef}
              style={[styles.searchInput, { color: theme.text }]}
              placeholder={t('home.search')}
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              testID="home-search-input"
              accessibilityLabel={t('home.search')}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </Glass>
          <GlassContainer spacing={8} style={styles.trailingCluster}>
            {trailing}
          </GlassContainer>
        </View>

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

      {searching ? null : (
        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}
          onLayout={e => setBottomH(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <GlassControl
            interactive
            onPress={() => enterCompose()}
            hitSlop={8}
            testID="home-new-thread"
            accessibilityRole="button"
            accessibilityLabel={t('home.newThread')}
            style={styles.circle}
          >
            <Icon name="square.and.pencil" size={18} color={theme.text} />
          </GlassControl>
        </View>
      )}
    </View>
  );
}

const CIRCLE = 44;

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  topRowSidebar: { paddingHorizontal: 0 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    paddingHorizontal: 16,
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
    fontSize: 20,
    fontWeight: '500',
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
  rowMenuOpen: {
    borderRadius: 12,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '400' },
  unseen: { fontWeight: '500' },
  subtitle: { fontSize: 15 },
  prStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prStatusText: { flex: 1 },
  elapsed: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    marginLeft: 12,
    textAlign: 'right',
  },
  pinnedSection: { paddingBottom: 12 },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  archivedIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedLabel: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
