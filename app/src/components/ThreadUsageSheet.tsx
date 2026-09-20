import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionSheet } from './SessionSheet';
import { AgentUsageMeters } from './AgentUsageMeters';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { useRuntime } from '../app/runtimeContext';
import { agentAccountsClient, PROVIDERS } from '../zeron/accounts/accounts';
import type { AgentAccountsSnapshot } from '../zeron/protocol/types';

export function ThreadUsageSheet({
  deviceId,
  onDismiss,
}: {
  deviceId: string;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const runtime = useRuntime();
  const [snapshot, setSnapshot] = useState<AgentAccountsSnapshot | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (runtime === null) {
      setError(t('session.usage.error'));
      return;
    }
    let cancelled = false;
    agentAccountsClient(runtime.relayFor(deviceId))
      .list(true)
      .then(s => {
        if (!cancelled) {
          setSnapshot(s);
          setError(undefined);
        }
      })
      .catch(e => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, deviceId]);

  const reporting = useMemo(
    () => (snapshot?.accounts ?? []).filter(a => a.usageWindows.length > 0),
    [snapshot],
  );

  const loading = snapshot === undefined && error === undefined;

  return (
    <SessionSheet onDismiss={onDismiss}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Text style={[styles.title, { color: theme.text }]}>
          {t('session.usage')}
        </Text>
        {loading ? (
          <ActivityIndicator
            color={theme.textSecondary}
            style={styles.spinner}
          />
        ) : error !== undefined ? (
          <Text style={[styles.empty, { color: theme.danger }]}>{error}</Text>
        ) : reporting.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {t('session.usage.empty')}
          </Text>
        ) : (
          <View style={styles.list}>
            {PROVIDERS.map(p => {
              const accounts = reporting.filter(a => a.harness === p.harness);
              if (accounts.length === 0) return null;
              return (
                <View key={p.harness} style={styles.provider}>
                  <Text style={[styles.providerName, { color: theme.text }]}>
                    {p.name}
                  </Text>
                  {accounts.map(a => (
                    <View key={a.id} style={styles.account}>
                      <Text
                        style={[styles.accountName, { color: theme.text }]}
                        maxFontSizeMultiplier={1.6}
                      >
                        {a.displayName ?? a.email ?? a.id}
                        {a.planLabel !== undefined ? ` · ${a.planLabel}` : ''}
                      </Text>
                      <AgentUsageMeters windows={a.usageWindows} />
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SessionSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
    marginBottom: 20,
  },
  spinner: { marginTop: 24 },
  empty: {
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginTop: 12,
  },
  list: {
    paddingHorizontal: 20,
    gap: 20,
  },
  provider: { gap: 10 },
  providerName: { fontSize: 13, fontWeight: '600' },
  account: { gap: 6 },
  accountName: { fontSize: 16 },
});
