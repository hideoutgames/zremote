// Previews for the session's checkout — WatchPreviews {chatId} →
// PreviewSnapshot {services, proxyPort, error?, projectName?, remote}
// (proto preview.rs L34-56; stream dispatch rpc.rs ~L1810). Each service's
// URL is http://{hostname}:{proxyPort} (PreviewService.url, preview.rs
// L28-32). Opened in an in-app browser (openBrowserAsync →
// SFSafariViewController); the preview proxy on the host serves plain HTTP
// — the edge /preview/{org}/ws route is a separate device-registration
// channel gated on the edge JWT (edge/src/preview-route.ts), not on these
// URLs, so no bearer is needed to view them.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import * as ContextMenu from 'zeego/context-menu';
import { useRuntime } from '../app/runtimeContext';
import { useChat } from '../zeron/state/workspaceStore';
import { METHODS } from '../zeron/protocol/rpc';
import type { PreviewSnapshot } from '../zeron/protocol/types';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { Icon } from '../components/Icon';

export function PreviewsScreen({
  chatId,
  embedded,
}: {
  chatId: string;
  embedded?: boolean;
}) {
  const theme = useTheme();
  const runtime = useRuntime();
  const chat = useChat(chatId);
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (runtime === null || chat?.deviceId === undefined) return;
    let cancelled = false;
    let stream: { cancel(): void } | undefined;
    runtime
      .relayFor(chat.deviceId)
      .stream<PreviewSnapshot>(METHODS.WATCH_PREVIEWS, { chatId })
      .then(async s => {
        if (cancelled) {
          s.cancel();
          return;
        }
        stream = s;
        for await (const snap of s.items) if (!cancelled) setSnapshot(snap);
      })
      .catch(e => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
      stream?.cancel();
    };
  }, [runtime, chat?.deviceId, chatId]);

  const proxyPort = snapshot?.proxyPort;
  const services = snapshot?.services ?? [];
  const url = (hostname: string): string =>
    `http://${hostname}:${proxyPort ?? ''}`;

  let body: React.ReactNode;
  if (error !== undefined || snapshot?.error !== undefined) {
    body = (
      <Text style={[styles.msg, { color: theme.danger }]}>
        {error ?? snapshot?.error ?? t('previews.error')}
      </Text>
    );
  } else if (snapshot === undefined) {
    body = <ActivityIndicator style={styles.msg} />;
  } else if (services.length === 0) {
    body = (
      <Text style={[styles.msg, { color: theme.textSecondary }]}>
        {t('previews.empty')}
      </Text>
    );
  } else {
    body = (
      <ScrollView>
        {services.map(s => {
          const u = url(s.hostname);
          return (
            <ContextMenu.Root key={s.id}>
              <ContextMenu.Trigger>
                <Pressable
                  onPress={() => WebBrowser.openBrowserAsync(u).catch(() => {})}
                  hitSlop={4}
                  accessibilityRole="link"
                  accessibilityLabel={`${s.name}, ${u}`}
                  style={[styles.row, { borderBottomColor: theme.border }]}
                >
                  <Icon name="safari" size={16} color={theme.textSecondary} />
                  <View style={styles.rowText}>
                    <Text
                      style={[styles.name, { color: theme.text }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.6}
                    >
                      {s.name}
                      {s.zeronOwned ? ` · ${t('previews.zeronOwned')}` : ''}
                    </Text>
                    <Text
                      style={[styles.url, { color: theme.textSecondary }]}
                      numberOfLines={1}
                    >
                      {`${u} · :${s.port} · ${s.deviceName}`}
                    </Text>
                  </View>
                  <Icon
                    name="chevron.right"
                    size={13}
                    color={theme.textSecondary}
                  />
                </Pressable>
              </ContextMenu.Trigger>
              <ContextMenu.Content>
                <ContextMenu.Item
                  key="open"
                  onSelect={() =>
                    WebBrowser.openBrowserAsync(u).catch(() => {})
                  }
                >
                  <ContextMenu.ItemTitle>
                    {t('previews.open')}
                  </ContextMenu.ItemTitle>
                </ContextMenu.Item>
                <ContextMenu.Item
                  key="copy"
                  onSelect={() => Clipboard.setStringAsync(u).catch(() => {})}
                >
                  <ContextMenu.ItemTitle>
                    {t('previews.copyUrl')}
                  </ContextMenu.ItemTitle>
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.root,
        embedded ? undefined : { backgroundColor: theme.background },
      ]}
    >
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  msg: { padding: 16, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 14 },
  url: { fontSize: 11, fontFamily: 'monospace' },
});
