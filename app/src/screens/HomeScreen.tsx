// Home (left pager page): search, spaces filter, the sessions list driven by
// workspaceStore, archived shelf, connection pill, New session + Settings.

import React, { useCallback, useMemo, useState } from 'react';
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
import * as DropdownMenu from 'zeego/dropdown-menu';
import * as ContextMenu from 'zeego/context-menu';
import { useStore } from 'zustand';
import {
  workspaceStore,
  useOverviewChats,
  useArchivedChats,
  useIndicator,
  useHostForChat,
  useDeviceOnline,
} from '../zeron/state/workspaceStore';
import { chatUnseen } from '../zeron/doc/workspaceProjection';
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
import type { ChatIndicator } from '../zeron/protocol/entities';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { NewSessionSheet } from './NewSessionSheet';
import { useTheme, type Theme } from '../theme';
import { t } from '../i18n/strings';

const indicatorColor = (theme: Theme, i: ChatIndicator): string | null => {
  switch (i) {
    case 'awaitingInput':
      return theme.indicatorAwaitingInput;
    case 'errored':
      return theme.indicatorErrored;
    case 'working':
      return theme.indicatorWorking;
    case 'completed':
      return theme.indicatorCompleted;
    default:
      return null;
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
  const online = useDeviceOnline(chat.deviceId);
  const unseen = chatUnseen(chat);
  const dot = indicatorColor(theme, indicator);
  const [hovered, setHovered] = useState(false);
  const at = chat.lastMessageAt ?? chat.createdAt;

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
          accessibilityLabel={[
            sessionTitle(chat),
            indicator,
            hostLabel(chat, host === undefined ? [] : [host]),
          ]
            .filter(Boolean)
            .join(', ')}
        >
          {dot !== null ? (
            <View style={[styles.dot, { backgroundColor: dot }]} />
          ) : (
            <View style={styles.dotPlaceholder} />
          )}
          <View style={styles.rowText}>
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
            <Text
              style={[styles.subtitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {[
                hostLabel(chat, host === undefined ? [] : [host]),
                checkoutLabel(chat),
                relativeTime(at, Date.now()),
              ]
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
          <View
            style={[
              styles.onlineDot,
              {
                backgroundColor: online
                  ? theme.indicatorCompleted
                  : theme.border,
              },
            ]}
          />
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
}: {
  onOpenSession: (chatId: string) => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [spaceFilter, setSpaceFilter] = useState<string | undefined>(undefined);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const runtime = useRuntime();

  // Pull-to-refresh kicks the registry + open session rooms (same path the
  // foreground handler uses — appRuntime.onForeground L270).
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

  const chats = useMemo(() => {
    const scoped =
      spaceFilter === undefined
        ? overview
        : overview.filter(c => c.spaceId === spaceFilter);
    const q = query.trim().toLowerCase();
    if (q === '') return scoped;
    return scoped.filter(c =>
      `${c.title ?? ''} ${c.lastMessagePreview ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [overview, spaceFilter, query]);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
        <View
          style={[styles.search, { backgroundColor: theme.inputBackground }]}
        >
          <Icon name="magnifyingglass" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder={t('home.search')}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
        </View>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Glass interactive style={styles.filterPill}>
              <Text
                style={[styles.filterText, { color: theme.text }]}
                numberOfLines={1}
              >
                {spaceFilter === undefined
                  ? t('home.allSpaces')
                  : spaceName(spaceFilter)}
              </Text>
              <Icon name="chevron.down" size={12} color={theme.textSecondary} />
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
                onSelect={() => setSheetOpen(true)}
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
      </View>

      {connection !== 'connected' ? (
        <View style={[styles.pill, { backgroundColor: theme.cardBackground }]}>
          <Text style={[styles.pillText, { color: theme.textSecondary }]}>
            {connection === 'connecting'
              ? t('home.connection.connecting')
              : t('home.connection.disconnected')}
          </Text>
        </View>
      ) : null}

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
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={renderRow}
      />

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable
          style={styles.newChatWrap}
          onPress={() => setSheetOpen(true)}
          hitSlop={8}
        >
          <Glass interactive style={styles.newChat}>
            <Icon name="plus" size={16} color={theme.text} />
            <Text style={[styles.newChatText, { color: theme.text }]}>
              {t('home.newSession')}
            </Text>
          </Glass>
        </Pressable>
        <Pressable onPress={onOpenSettings} hitSlop={8}>
          <Glass interactive style={styles.circle}>
            <Icon name="gearshape" size={20} color={theme.text} />
          </Glass>
        </Pressable>
      </View>

      {sheetOpen ? (
        <NewSessionSheet
          initialSpaceId={spaceFilter}
          onClose={() => setSheetOpen(false)}
          onCreated={id => {
            setSheetOpen(false);
            onOpenSession(id);
          }}
        />
      ) : null}
    </View>
  );
}

const CIRCLE = 44;

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  },
  searchInput: { flex: 1, fontSize: 17, padding: 0 },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: CIRCLE,
    paddingHorizontal: 14,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
    maxWidth: 160,
  },
  filterText: { fontSize: 14, fontWeight: '500' },
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
  title: { fontSize: 18, fontWeight: '500' },
  unseen: { fontWeight: '700' },
  subtitle: { fontSize: 14 },
  preview: { fontSize: 13 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  bottomBar: {
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
});
