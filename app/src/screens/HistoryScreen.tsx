// Git history for the session's checkout — ListGitHistory paged rows
// (subject, author, relative date, short sha), SearchGitHistory (debounced),
// ResolveGitAvatars (optional — renders initials when absent), FetchAll in
// the header. Copy sha via context menu.

import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ContextMenu from 'zeego/context-menu';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import { gitHistoryClient, historyReducer } from '../zeron/history/history';
import type { HistoryState } from '../zeron/history/history';
import type { GitHistoryCommit } from '../zeron/protocol/types';
import { relativeTime } from './HomeScreen';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function HistoryScreen({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const cwd = chat?.cwd;
  const [state, dispatch] = useReducer(historyReducer, {
    commits: [],
    query: '',
    loading: false,
  } as HistoryState);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const client =
    runtime !== null && chat?.deviceId !== undefined
      ? gitHistoryClient(runtime.relayFor(chat.deviceId))
      : undefined;

  const load = useCallback(
    (cursor = 0, query = '', append = false) => {
      if (client === undefined || cwd === undefined) return;
      dispatch({ type: 'loading' });
      const call =
        query === ''
          ? client.list(cwd, cursor)
          : client.search(cwd, query, cursor);
      call
        .then(page => dispatch({ type: 'page', page, append }))
        .catch(e =>
          dispatch({ type: 'error', message: String(e?.message ?? e) }),
        );
    },
    [client, cwd],
  );

  useEffect(() => load(), [load]);

  // Resolve avatars for visible authors once per page.
  useEffect(() => {
    if (client === undefined || cwd === undefined) return;
    const missing = state.commits
      .filter(c => avatars[c.authorEmail] === undefined)
      .map(c => ({ sha: c.sha, email: c.authorEmail }))
      .slice(0, 50);
    if (missing.length === 0) return;
    client
      .avatars(cwd, missing)
      .then(m => setAvatars(prev => ({ ...prev, ...m })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.commits, client, cwd]);

  const onSearch = useCallback(
    (q: string) => {
      dispatch({ type: 'query', query: q });
      if (searchTimer.current !== undefined) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => load(0, q), 250);
    },
    [load],
  );

  const onFetchAll = useCallback(() => {
    if (client === undefined || cwd === undefined) return;
    setFetching(true);
    client
      .fetchAll(cwd)
      .catch(() => {})
      .finally(() => {
        setFetching(false);
        load();
      });
  }, [client, cwd, load]);

  const row = (c: GitHistoryCommit) => (
    <ContextMenu.Root key={c.sha}>
      <ContextMenu.Trigger>
        <Pressable
          style={[styles.row, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel={`${c.subject}, ${c.authorName}`}
        >
          <View style={[styles.avatar, { backgroundColor: theme.surface }]}>
            <Text style={[styles.avatarText, { color: theme.textSecondary }]}>
              {initials(c.authorName)}
            </Text>
          </View>
          <View style={styles.rowBody}>
            <Text
              style={[styles.subject, { color: theme.text }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {c.subject}
            </Text>
            <Text
              style={[styles.meta, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {`${c.authorName} · ${relativeTime(
                Date.parse(c.authoredAt),
                Date.now(),
              )} · ${c.sha.slice(0, 7)}`}
            </Text>
          </View>
          {c.refs.map((r, i) => (
            <Text
              key={i}
              style={[
                styles.ref,
                { color: theme.accent, borderColor: theme.border },
              ]}
            >
              {r.label}
            </Text>
          ))}
        </Pressable>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item
          key="sha"
          onSelect={() => Clipboard.setStringAsync(c.sha).catch(() => {})}
        >
          <ContextMenu.ItemTitle>{t('history.copySha')}</ContextMenu.ItemTitle>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { borderBottomColor: theme.border }]}>
        <TextInput
          placeholder={t('history.search')}
          placeholderTextColor={theme.textSecondary}
          onChangeText={onSearch}
          style={[
            styles.search,
            { color: theme.text, backgroundColor: theme.inputBackground },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('history.search')}
        />
        <Pressable
          onPress={onFetchAll}
          disabled={fetching}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('history.fetch')}
          accessibilityState={{ busy: fetching }}
          style={styles.barBtn}
        >
          {fetching ? (
            <ActivityIndicator size="small" />
          ) : (
            <Icon name="arrow.clockwise" size={16} color={theme.text} />
          )}
        </Pressable>
      </View>
      {state.error !== undefined ? (
        <Text style={[styles.err, { color: theme.danger }]}>{state.error}</Text>
      ) : null}
      <ScrollView
        onScroll={e => {
          const { contentOffset, contentSize, layoutMeasurement } =
            e.nativeEvent;
          if (
            contentOffset.y + layoutMeasurement.height >=
              contentSize.height - 200 &&
            state.nextCursor !== undefined &&
            !state.loading
          )
            load(state.nextCursor, state.query, true);
        }}
        scrollEventThrottle={200}
      >
        {state.commits.map(row)}
        {state.loading ? <ActivityIndicator style={styles.spin} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  barBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
  },
  err: { fontSize: 12, padding: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarText: { fontSize: 11 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  subject: { fontSize: 14 },
  meta: { fontSize: 11 },
  ref: {
    fontSize: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  spin: { padding: 12 },
});
