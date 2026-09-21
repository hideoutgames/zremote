// Changes viewer — the session's checkout diff, relayed to the checkout's
// host. Subscribes to `WatchCheckoutDiffs` (stream of Vec<CheckoutDiff>,
// crates/engine/src/rpc.rs ~L1639-1730) and filters to the chat's
// checkoutId (resolved like desktop: chat.checkoutId → deviceId + cwd).
// Expanded files fetch per-file text via GetCheckoutFileDiffText
// ({checkoutId, cwd, path, diffChecksum} → {oldText?, newText?}); when the
// summary `patch` covers the file we parse that instead. States mirror the
// desktop diff pane: preparing / clean / error / rows.
// No commit/stage actions: the RPC surface exposes none.

import React, { useCallback, useEffect, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ContextMenu from '../components/menus/context-menu';
import * as Clipboard from 'expo-clipboard';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import { METHODS } from '../zeron/protocol/rpc';
import type {
  CheckoutDiff,
  CheckoutFileDiffText,
} from '../zeron/protocol/types';
import { diffForCheckout, diffPaneReducer } from '../zeron/diff/diffState';
import type { DiffPaneState } from '../zeron/diff/diffState';
import { parseUnified, type ParsedFileDiff } from '../zeron/diff/parseUnified';
import { FileDiff } from '../components/agentsKit/FileDiff';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import type { SFSymbol } from 'sf-symbols-typescript';

const leaf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const parentPath = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(0, -1).join('/');
};

const statusIcon = (status: string): SFSymbol =>
  status === 'added'
    ? 'plus'
    : status === 'deleted'
    ? 'minus'
    : status === 'renamed'
    ? 'arrow.right'
    : 'plus.forwardslash.minus';

export function ChangesScreen({
  chatId,
  embedded,
  onOpenHistory,
}: {
  chatId: string;
  /** Inside the iPad inspector — skip the standalone-screen chrome. */
  embedded?: boolean;
  /** Header "History" button → git history for this checkout. */
  onOpenHistory?: () => void;
}) {
  const theme = useTheme();
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const [state, dispatch] = useReducer(diffPaneReducer, {
    kind: 'preparing',
  } as DiffPaneState);
  const [fileText, setFileText] = useState<
    Record<string, ParsedFileDiff[] | 'loading' | 'error'>
  >({});

  const hostDeviceId = chat?.deviceId;
  // Desktop resolves checkoutId → device + cwd; when the chat row has no
  // checkoutId yet we match the stream by cwd instead.
  const checkoutId = chat?.checkoutId;
  const cwd = chat?.cwd;

  useEffect(() => {
    if (runtime === null || hostDeviceId === undefined) return;
    const relay = runtime.relayFor(hostDeviceId);
    if (relay.stream === undefined) {
      dispatch({ type: 'error', message: 'relay does not support streams' });
      return;
    }
    let cancelled = false;
    let stream: { cancel(): void } | undefined;
    relay
      .stream<CheckoutDiff[]>(METHODS.WATCH_CHECKOUT_DIFFS, {})
      .then(async s => {
        stream = s;
        for await (const diffs of s.items) {
          if (cancelled) break;
          const diff =
            checkoutId !== undefined
              ? diffForCheckout(diffs, checkoutId)
              : diffs.find(d => d.cwd === cwd);
          dispatch({ type: 'diff', diff });
        }
      })
      .catch(e => {
        if (!cancelled)
          dispatch({ type: 'error', message: String(e?.message ?? e) });
      });
    return () => {
      cancelled = true;
      stream?.cancel();
    };
  }, [runtime, hostDeviceId, checkoutId, cwd]);

  const toggleFile = useCallback(
    (path: string) => {
      dispatch({ type: 'toggle', path });
      setFileText(prev => {
        if (prev[path] !== undefined) return prev;
        return { ...prev, [path]: 'loading' };
      });
      // Prefer the streamed patch slice when it parses to this file; else
      // fetch per-file diff text (entities.rs L726-746).
      const diff = state.kind === 'rows' ? state.diff : undefined;
      const parsed = diff !== undefined ? parseUnified(diff.patch) : [];
      const mine = parsed.filter(f => f.newPath === path || f.oldPath === path);
      if (mine.length > 0 && mine.some(f => f.hunks.length > 0)) {
        setFileText(prev => ({ ...prev, [path]: mine }));
        return;
      }
      if (runtime === null || diff === undefined) {
        setFileText(prev => ({ ...prev, [path]: 'error' }));
        return;
      }
      runtime
        .relayFor(diff.deviceId)
        .call<CheckoutFileDiffText>(METHODS.GET_CHECKOUT_FILE_DIFF_TEXT, {
          checkoutId: diff.checkoutId,
          cwd: diff.cwd,
          path,
          diffChecksum: diff.checksum,
        })
        .then(res => {
          const text = [res.oldText, res.newText]
            .filter((x): x is string => x !== undefined)
            .join('\n');
          setFileText(prev => ({
            ...prev,
            [path]: text === '' ? [] : parseUnified(text),
          }));
        })
        .catch(() => setFileText(prev => ({ ...prev, [path]: 'error' })));
    },
    [state, runtime],
  );

  const copy = useCallback((_label: string, value: string) => {
    Clipboard.setStringAsync(value).catch(() => {});
  }, []);

  let body: React.ReactNode;
  if (state.kind === 'preparing') {
    body = (
      <Centered>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('changes.preparing')}
        >
          <ActivityIndicator />
        </View>
      </Centered>
    );
  } else if (state.kind === 'clean') {
    body = (
      <Centered>
        <Text style={{ color: theme.textSecondary }}>{t('changes.clean')}</Text>
      </Centered>
    );
  } else if (state.kind === 'error') {
    body = (
      <Centered>
        <Text style={{ color: theme.danger }}>{state.message}</Text>
      </Centered>
    );
  } else {
    body = (
      <ScrollView>
        {state.diff.files.map(f => {
          const expanded = state.expanded.has(f.path);
          const loaded = fileText[f.path];
          const parent = parentPath(f.path);
          const subtitle =
            f.oldPath !== undefined ? `${leaf(f.oldPath)} → ${parent}` : parent;
          const iconColor =
            f.status === 'added'
              ? theme.diffAddText
              : f.status === 'deleted'
              ? theme.diffDelText
              : theme.textSecondary;
          return (
            <View
              key={f.path}
              style={{
                borderBottomColor: theme.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              }}
            >
              <ContextMenu.Root>
                <ContextMenu.Trigger>
                  <Pressable
                    onPress={() => toggleFile(f.path)}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.path}, ${f.status}, +${f.additions} -${f.deletions}`}
                    accessibilityState={{ expanded }}
                    style={styles.row}
                  >
                    <Icon
                      name={statusIcon(f.status)}
                      size={14}
                      color={iconColor}
                    />
                    <View style={styles.names}>
                      <Text
                        style={[styles.path, { color: theme.text }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.6}
                      >
                        {leaf(f.path)}
                      </Text>
                      {subtitle !== '' ? (
                        <Text
                          style={[
                            styles.parent,
                            { color: theme.textSecondary },
                          ]}
                          numberOfLines={1}
                        >
                          {subtitle}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.count, { color: theme.diffAddText }]}>
                      {f.additions > 0 ? `+${f.additions}` : ''}
                    </Text>
                    <Text style={[styles.count, { color: theme.diffDelText }]}>
                      {f.deletions > 0 ? `-${f.deletions}` : ''}
                    </Text>
                    <Icon
                      name={expanded ? 'chevron.down' : 'chevron.right'}
                      size={14}
                      color={theme.textSecondary}
                    />
                  </Pressable>
                </ContextMenu.Trigger>
                <ContextMenu.Content>
                  <ContextMenu.Item
                    key="copyPath"
                    onSelect={() => copy(t('changes.copyPath'), f.path)}
                  >
                    <ContextMenu.ItemTitle>
                      {t('changes.copyPath')}
                    </ContextMenu.ItemTitle>
                    <ContextMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    key="copyPatch"
                    onSelect={() =>
                      copy(
                        t('changes.copyPatch'),
                        state.diff.patch.slice(0, 20000),
                      )
                    }
                  >
                    <ContextMenu.ItemTitle>
                      {t('changes.copyPatch')}
                    </ContextMenu.ItemTitle>
                    <ContextMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Root>
              {expanded ? (
                <View style={styles.diff}>
                  {loaded === 'loading' || loaded === undefined ? (
                    <ActivityIndicator />
                  ) : loaded === 'error' ? (
                    <Text style={{ color: theme.danger }}>
                      {t('changes.error')}
                    </Text>
                  ) : loaded.length === 0 ? (
                    <Text style={{ color: theme.textSecondary }}>
                      {f.binary ? t('changes.binary') : t('changes.clean')}
                    </Text>
                  ) : (
                    loaded.map((pf, i) => <FileDiff key={i} file={pf} />)
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
        {state.diff.truncated ? (
          <Text style={[styles.truncated, { color: theme.textSecondary }]}>
            {t('changes.truncated')}
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  if (embedded)
    return (
      <View style={styles.root}>
        {onOpenHistory !== undefined ? (
          <Pressable
            onPress={onOpenHistory}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('history.title')}
            style={styles.historyBtn}
          >
            <Text style={[styles.historyLink, { color: theme.accent }]}>
              {t('history.title')}
            </Text>
          </Pressable>
        ) : null}
        {body}
      </View>
    );
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {onOpenHistory !== undefined ? (
        <Pressable
          onPress={onOpenHistory}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('history.title')}
          style={styles.historyBtn}
        >
          <Text style={[styles.historyLink, { color: theme.accent }]}>
            {t('history.title')}
          </Text>
        </Pressable>
      ) : null}
      {body}
    </View>
  );
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.centered}>{children}</View>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  names: { flex: 1, gap: 1 },
  path: { fontSize: 15 },
  parent: { fontSize: 12 },
  count: { fontSize: 13, fontVariant: ['tabular-nums'] },
  historyLink: { fontSize: 13 },
  historyBtn: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  diff: { paddingHorizontal: 8, paddingBottom: 8 },
  truncated: { padding: 12, fontSize: 12 },
});
