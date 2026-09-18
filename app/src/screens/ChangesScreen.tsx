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
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import { METHODS } from '../zeron/protocol/rpc';
import type {
  CheckoutDiff,
  CheckoutFileDiffText,
} from '../zeron/protocol/types';
import {
  diffForCheckout,
  diffPaneReducer,
  statusGlyph,
} from '../zeron/diff/diffState';
import type { DiffPaneState } from '../zeron/diff/diffState';
import { parseUnified, type ParsedFileDiff } from '../zeron/diff/parseUnified';
import { FileDiff } from '../components/agentsKit/FileDiff';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function ChangesScreen({
  chatId,
  embedded,
}: {
  chatId: string;
  /** Inside the iPad inspector — skip the standalone-screen chrome. */
  embedded?: boolean;
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

  const copy = useCallback((label: string, value: string) => {
    // @react-native-clipboard is not yet a dependency (same gap as
    // session.copyId) — show the value so it stays copyable.
    Alert.alert(label, value);
  }, []);

  let body: React.ReactNode;
  if (state.kind === 'preparing') {
    body = (
      <Centered>
        <ActivityIndicator />
        <Text style={{ color: theme.textSecondary }}>
          {t('changes.preparing')}
        </Text>
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
          return (
            <View
              key={f.path}
              style={{
                borderBottomColor: theme.border,
                borderBottomWidth: StyleSheet.hairlineWidth,
              }}
            >
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Pressable
                    onPress={() => toggleFile(f.path)}
                    accessibilityRole="button"
                    accessibilityLabel={`${f.path}, ${f.status}, +${f.additions} -${f.deletions}`}
                    accessibilityState={{ expanded }}
                    style={styles.row}
                  >
                    <Text
                      style={[styles.glyph, { color: theme.textSecondary }]}
                    >
                      {statusGlyph(f)}
                    </Text>
                    <Text
                      style={[styles.path, { color: theme.text }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.6}
                    >
                      {f.oldPath !== undefined
                        ? `${f.oldPath} → ${f.path}`
                        : f.path}
                    </Text>
                    <Text style={{ color: theme.diffAddText }}>
                      +{f.additions}
                    </Text>
                    <Text style={{ color: theme.diffDelText }}>
                      -{f.deletions}
                    </Text>
                  </Pressable>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    key="copyPath"
                    onSelect={() => copy(t('changes.copyPath'), f.path)}
                  >
                    <DropdownMenu.ItemTitle>
                      {t('changes.copyPath')}
                    </DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    key="copyPatch"
                    onSelect={() =>
                      copy(
                        t('changes.copyPatch'),
                        state.diff.patch.slice(0, 20000),
                      )
                    }
                  >
                    <DropdownMenu.ItemTitle>
                      {t('changes.copyPatch')}
                    </DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
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
                      {f.binary ? 'Binary file' : t('changes.clean')}
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

  if (embedded) return <View style={styles.root}>{body}</View>;
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
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
  },
  glyph: { fontFamily: 'monospace', fontSize: 12, width: 14 },
  path: { flex: 1, fontSize: 13 },
  diff: { paddingHorizontal: 8, paddingBottom: 8 },
  truncated: { padding: 12, fontSize: 12 },
});
