// Local diagnostic logs — thread folders, then one .txt per agent run.
// Same in-sheet navigation as Files: list, drill in, replace with a viewer.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useStore } from 'zustand';
import { Icon } from '../components/Icon';
import { CopyTextButton } from '../components/CopyTextButton';
import { t } from '../i18n/strings';
import { useTheme } from '../theme';
import {
  formatLogStamp,
  listLocalLogFiles,
  listLocalLogThreads,
  readLocalLog,
  subscribeLocalLogs,
  type LocalLogFile,
  type LocalLogThread,
} from '../zeron/diagnostics/localLogs';
import type { Chat } from '../zeron/protocol/types';
import { sessionTitle } from '../zeron/state/sessionTruth';
import { workspaceStore } from '../zeron/state/workspaceStore';

export function LocalLogsScreen() {
  const theme = useTheme();
  const chats = useStore(workspaceStore, s => s.chats);
  const [threads, setThreads] = useState<LocalLogThread[] | undefined>(
    undefined,
  );
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<LocalLogFile[] | undefined>(undefined);
  const [openFile, setOpenFile] = useState<LocalLogFile | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      listLocalLogThreads()
        .then(rows => {
          if (live) setThreads(rows);
        })
        .catch(() => {
          if (live) setThreads([]);
        });
    };
    load();
    const unsub = subscribeLocalLogs(load);
    return () => {
      live = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (folder === undefined) return;
    let live = true;
    const load = (): void => {
      listLocalLogFiles(folder)
        .then(rows => {
          if (live) setFiles(rows);
        })
        .catch(() => {
          if (live) setFiles([]);
        });
    };
    load();
    const unsub = subscribeLocalLogs(load);
    return () => {
      live = false;
      unsub();
    };
  }, [folder]);

  if (openFile !== undefined) {
    return (
      <LogFileView file={openFile} onClose={() => setOpenFile(undefined)} />
    );
  }

  const now = Date.now();
  const folderTitle =
    folder === undefined
      ? t('settings.viewLocalLogs')
      : sessionTitle(chats.find(c => c.id === folder));

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.nav}>
        {folder !== undefined ? (
          <Pressable
            onPress={() => {
              setFolder(undefined);
              setFiles(undefined);
            }}
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
        <Text
          style={[styles.folderTitle, { color: theme.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {folderTitle}
        </Text>
        <View style={styles.barBtn} />
      </View>
      {folder === undefined ? (
        <ThreadList
          threads={threads}
          chats={chats}
          now={now}
          onOpen={chatId => setFolder(chatId)}
        />
      ) : (
        <FileList files={files} now={now} onOpen={setOpenFile} />
      )}
    </View>
  );
}

function ThreadList({
  threads,
  chats,
  now,
  onOpen,
}: {
  threads: LocalLogThread[] | undefined;
  chats: Chat[];
  now: number;
  onOpen: (chatId: string) => void;
}) {
  const theme = useTheme();
  if (threads === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (threads.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        {t('settings.localLogsEmpty')}
      </Text>
    );
  }
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {threads.map(thread => {
        const title = sessionTitle(chats.find(c => c.id === thread.chatId));
        const when = formatLogStamp(thread.latestAt, now);
        return (
          <Pressable
            key={thread.chatId}
            onPress={() => onOpen(thread.chatId)}
            accessibilityRole="button"
            accessibilityLabel={`${title}, ${thread.chatId}, ${when}`}
            style={[styles.row, { borderBottomColor: theme.border }]}
          >
            <Icon name="folder" size={16} color={theme.textSecondary} />
            <View style={styles.rowBody}>
              <Text
                style={[styles.name, { color: theme.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.6}
              >
                {title}
              </Text>
              <Text
                style={[styles.sub, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {thread.chatId}
              </Text>
            </View>
            <Text style={[styles.when, { color: theme.textSecondary }]}>
              {when}
            </Text>
            <Icon name="chevron.right" size={14} color={theme.textSecondary} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FileList({
  files,
  now,
  onOpen,
}: {
  files: LocalLogFile[] | undefined;
  now: number;
  onOpen: (file: LocalLogFile) => void;
}) {
  const theme = useTheme();
  if (files === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (files.length === 0) {
    return (
      <Text style={[styles.empty, { color: theme.textSecondary }]}>
        {t('settings.localLogsEmpty')}
      </Text>
    );
  }
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {files.map(file => {
        const when = formatLogStamp(file.at, now);
        return (
          <Pressable
            key={file.path}
            onPress={() => onOpen(file)}
            accessibilityRole="button"
            accessibilityLabel={when}
            style={[styles.row, { borderBottomColor: theme.border }]}
          >
            <Icon name="doc.text" size={16} color={theme.textSecondary} />
            <Text
              style={[styles.name, { color: theme.text }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.6}
            >
              {when}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function LogFileView({
  file,
  onClose,
}: {
  file: LocalLogFile;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [body, setBody] = useState<string | undefined>(undefined);
  const title = formatLogStamp(file.at, Date.now());

  useEffect(() => {
    let live = true;
    setBody(undefined);
    readLocalLog(file.path)
      .then(text => {
        if (live) setBody(text ?? '');
      })
      .catch(() => {
        if (live) setBody('');
      });
    return () => {
      live = false;
    };
  }, [file.path]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.nav, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('session.back')}
          style={styles.barBtn}
        >
          <Icon name="chevron.left" size={16} color={theme.text} />
        </Pressable>
        <Text
          style={[styles.folderTitle, { color: theme.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <CopyTextButton text={body ?? ''} disabled={body === undefined} />
      </View>
      {body === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.logContent}
        >
          <Text selectable style={[styles.log, { color: theme.text }]}>
            {body}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
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
  empty: { padding: 24, textAlign: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  name: { flex: 1, fontSize: 17 },
  sub: { fontSize: 12, marginTop: 2 },
  when: { fontSize: 13 },
  logContent: { padding: 12, paddingBottom: 24 },
  log: { fontSize: 12, lineHeight: 17, fontFamily: 'Menlo' },
});
