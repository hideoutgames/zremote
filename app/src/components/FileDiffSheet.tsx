import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { Icon } from './Icon';
import { Glass } from './Glass';
import { FileDiff } from './agentsKit/FileDiff';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { parseUnified, type ParsedFileDiff } from '../zeron/diff/parseUnified';
import { fileDiffFromText } from '../zeron/diff/fileDiffFromText';
import { METHODS } from '../zeron/protocol/rpc';
import type {
  CheckoutDiff,
  CheckoutFileDiffText,
  ToolDiff,
} from '../zeron/protocol/types';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';

export interface FileDiffRequest {
  path: string;
  additions: number;
  deletions: number;
  diff?: ToolDiff;
}

const leaf = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function FileDiffSheet({
  chatId,
  request,
  onDismiss,
}: {
  chatId: string;
  request: FileDiffRequest;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sheet = useRef<TrueSheet>(null);
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const [files, setFiles] = useState<ParsedFileDiff[] | 'loading' | 'error'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;
    const fromTool = request.diff;
    if (fromTool !== undefined) {
      setFiles([
        fileDiffFromText(request.path, fromTool.oldText, fromTool.newText),
      ]);
      return;
    }
    if (runtime === null || chat?.deviceId === undefined) {
      setFiles('error');
      return;
    }
    const relay = runtime.relayFor(chat.deviceId);
    (async () => {
      try {
        if (relay.stream !== undefined) {
          const stream = await relay.stream<CheckoutDiff[]>(
            METHODS.WATCH_CHECKOUT_DIFFS,
            {},
          );
          const iter = stream.items[Symbol.asyncIterator]();
          const first = await iter.next();
          stream.cancel();
          const diffs = first.value ?? [];
          const mine =
            diffs.find(d => d.checkoutId === chat.checkoutId) ??
            diffs.find(d => d.cwd === chat.cwd);
          if (mine !== undefined) {
            const parsed = parseUnified(mine.patch).filter(
              f => f.newPath === request.path || f.oldPath === request.path,
            );
            if (parsed.some(f => f.hunks.length > 0)) {
              if (!cancelled) setFiles(parsed);
              return;
            }
            const res = await relay.call<CheckoutFileDiffText>(
              METHODS.GET_CHECKOUT_FILE_DIFF_TEXT,
              {
                checkoutId: mine.checkoutId,
                cwd: mine.cwd,
                path: request.path,
                diffChecksum: mine.checksum,
              },
            );
            if (!cancelled)
              setFiles([
                fileDiffFromText(request.path, res.oldText, res.newText),
              ]);
            return;
          }
        }
        if (!cancelled) setFiles('error');
      } catch {
        if (!cancelled) setFiles('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, runtime, chat]);

  return (
    <TrueSheet
      ref={sheet}
      detents={[1]}
      initialDetentIndex={0}
      onDidDismiss={onDismiss}
      grabber
      backgroundColor={theme.background}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => sheet.current?.dismiss()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('session.back')}
        >
          <Glass style={styles.close}>
            <Icon name="xmark" size={15} color={theme.text} />
          </Glass>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {leaf(request.path)}
        </Text>
        <View style={styles.stats}>
          {request.additions > 0 ? (
            <Text style={{ color: theme.diffAddText }}>
              {`+${request.additions}`}
            </Text>
          ) : null}
          {request.deletions > 0 ? (
            <Text style={{ color: theme.diffDelText }}>
              {`-${request.deletions}`}
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {files === 'loading' ? (
          <ActivityIndicator style={styles.center} />
        ) : files === 'error' ? (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.diffUnavailable')}
          </Text>
        ) : files.length === 0 || files.every(f => f.hunks.length === 0) ? (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.diffUnavailable')}
          </Text>
        ) : (
          files.map((file, i) => <FileDiff key={i} file={file} />)
        )}
      </ScrollView>
    </TrueSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  stats: {
    flexDirection: 'row',
    gap: 6,
    minWidth: 32,
    justifyContent: 'flex-end',
  },
  center: { marginTop: 40 },
  empty: { padding: 20, fontSize: 15, textAlign: 'center' },
});
