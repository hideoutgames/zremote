// Workspace files browser — relayed to the session's checkout host.
// RPC shapes: crates/proto/src/entities.rs L384-640, dispatched in
// crates/engine/src/rpc.rs ~L2089-2144. Target is the chat
// (WorkspaceTarget {chatId}). Errors surface verbatim — path-jail
// rejections included. `.git` is never listed by the host and is also
// filtered client-side in filesPaneReducer. Ignored files are opt-in
// (`includeIgnored`); ignored rows render dimmed (ARCHITECTURE.md:
// ignored content never leaves the host).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import {
  workspaceFilesClient,
  filesPaneReducer,
} from '../zeron/files/filesClient';
import type { WorkspaceFilesClient } from '../zeron/files/filesClient';
import type {
  WorkspaceEntry,
  WorkspaceFileChanges,
  WorkspaceTarget,
} from '../zeron/protocol/types';
import { FileEditorScreen } from './FileEditorScreen';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|avif)$/i;

const leaf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function FilesScreen({
  chatId,
  embedded: _embedded,
}: {
  chatId: string;
  embedded?: boolean;
}) {
  const theme = useTheme();
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const [dir, setDir] = useState('');
  const [state, dispatch] = useReducer(filesPaneReducer, {
    directory: '',
    entries: [],
    includeIgnored: false,
    truncated: false,
  });
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<WorkspaceEntry[] | undefined>(
    undefined,
  );
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);

  const target: WorkspaceTarget = useMemo(() => ({ chatId }), [chatId]);
  const client: WorkspaceFilesClient | undefined = useMemo(
    () =>
      runtime !== null && chat?.deviceId !== undefined
        ? workspaceFilesClient(runtime.relayFor(chat.deviceId))
        : undefined,
    [runtime, chat?.deviceId],
  );

  const load = useCallback(
    (directory: string, includeIgnored: boolean) => {
      if (client === undefined) return;
      client
        .listDirectory(target, directory, { includeIgnored })
        .then(page => dispatch({ type: 'page', directory, page }))
        .catch(e =>
          dispatch({ type: 'error', message: String(e?.message ?? e) }),
        );
    },
    [client, target],
  );

  useEffect(() => {
    load(dir, state.includeIgnored);
  }, [load, dir, state.includeIgnored]);

  // WatchWorkspaceFiles → refresh listing; resyncRequired forces a reload.
  useEffect(() => {
    if (client === undefined) return;
    let cancelled = false;
    let stream: { cancel(): void } | undefined;
    client
      .watchFiles(target)
      .then(async s => {
        stream = s;
        for await (const batch of s.items as AsyncIterable<WorkspaceFileChanges>) {
          if (cancelled) break;
          if (batch.resyncRequired || batch.changes.length > 0)
            load(dir, state.includeIgnored);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stream?.cancel();
    };
  }, [client, target, load, dir, state.includeIgnored]);

  // Debounced fuzzy search (host-side fuzzy match via SearchWorkspaceFiles).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const onSearch = useCallback(
    (q: string) => {
      setSearch(q);
      if (searchTimer.current !== undefined) clearTimeout(searchTimer.current);
      if (q.trim() === '') {
        setMatches(undefined);
        return;
      }
      searchTimer.current = setTimeout(() => {
        client
          ?.search(target, q, {
            includeIgnored: state.includeIgnored,
            limit: 50,
          })
          .then(ms =>
            setMatches(
              ms.map(m => ({
                path: m.path,
                name: m.name,
                kind: m.kind,
                ignored: false,
                readOnly: false,
              })),
            ),
          )
          .catch(e =>
            dispatch({ type: 'error', message: String(e?.message ?? e) }),
          );
      }, 250);
    },
    [client, target, state.includeIgnored],
  );

  const openEntry = useCallback((e: WorkspaceEntry) => {
    if (e.kind === 'directory') {
      setDir(e.path);
      setSearch('');
      setMatches(undefined);
    } else if (e.kind === 'file') {
      setOpenFile(e.path);
    }
  }, []);

  if (openFile !== undefined && client !== undefined) {
    return (
      <FileEditorScreen
        client={client}
        target={target}
        path={openFile}
        onClose={() => setOpenFile(undefined)}
        image={IMAGE_EXT.test(openFile)}
      />
    );
  }

  const rows = matches ?? state.entries;
  const folderTitle =
    dir !== '' ? leaf(dir) : chat?.cwd !== undefined ? leaf(chat.cwd) : '';
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.nav}>
        {dir !== '' ? (
          <Pressable
            onPress={() => setDir(dir.split('/').slice(0, -1).join('/'))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('session.back')}
            style={styles.barBtn}
          >
            <Icon name="chevron.left" size={16} color={theme.text} />
          </Pressable>
        ) : (
          <View style={styles.barBtn} />
        )}
        {folderTitle !== '' ? (
          <Text
            style={[styles.folderTitle, { color: theme.text }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {folderTitle}
          </Text>
        ) : (
          <View style={styles.folderTitle} />
        )}
        <Pressable
          onPress={() => dispatch({ type: 'toggleIgnored' })}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            state.includeIgnored
              ? t('files.hideIgnored')
              : t('files.showIgnored')
          }
          accessibilityState={{ checked: state.includeIgnored }}
          style={styles.barBtn}
        >
          <Icon
            name={state.includeIgnored ? 'eye.slash' : 'eye'}
            size={16}
            color={state.includeIgnored ? theme.accent : theme.textSecondary}
          />
        </Pressable>
      </View>
      <View
        style={[styles.searchWrap, { backgroundColor: theme.inputBackground }]}
      >
        <Icon name="magnifyingglass" size={14} color={theme.textSecondary} />
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder={t('files.search')}
          placeholderTextColor={theme.textSecondary}
          style={[styles.search, { color: theme.text }]}
          accessibilityLabel={t('files.search')}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {state.error !== undefined ? (
        <Text style={[styles.hint, { color: theme.danger }]}>
          {state.error}
        </Text>
      ) : null}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {rows.length === 0 && state.error === undefined ? (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('files.empty')}
          </Text>
        ) : null}
        {rows.map(e => (
          <Pressable
            key={e.path}
            onPress={() => openEntry(e)}
            accessibilityRole="button"
            accessibilityLabel={`${e.name}, ${e.kind}`}
            style={[
              styles.row,
              { borderBottomColor: theme.border },
              e.ignored ? styles.ignored : undefined,
            ]}
          >
            <Icon
              name={e.kind === 'directory' ? 'folder' : 'doc.text'}
              size={16}
              color={theme.textSecondary}
            />
            <Text
              style={[styles.name, { color: theme.text }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {e.name}
            </Text>
            {e.kind === 'directory' ? (
              <Icon
                name="chevron.right"
                size={14}
                color={theme.textSecondary}
              />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  barBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    minHeight: 36,
  },
  search: {
    flex: 1,
    paddingVertical: 6,
    fontSize: 16,
  },
  hint: { fontSize: 11, paddingHorizontal: 12, paddingVertical: 4 },
  empty: { padding: 24, textAlign: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontSize: 17 },
  ignored: { opacity: 0.5 },
});
