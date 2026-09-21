// Agent accounts for one host device (Settings → device row → "Agent
// accounts"). Provider cards, active account, plan label, usage meters with
// desktop thresholds (≥80% amber, ≥95% red, reset time), Switch / Forget,
// and the add flow: StartAgentLogin → paste-code (CompleteAgentLogin) or
// browser-poll (PollAgentLogin until done / CancelAgentLogin).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRuntime } from '../app/runtimeContext';
import {
  agentAccountsClient,
  forceUsageFor,
  PROVIDERS,
  type AccountsLoadTrigger,
} from '../zeron/accounts/accounts';
import type {
  AgentAccountsSnapshot,
  AgentLoginStart,
} from '../zeron/protocol/types';
import { AgentUsageMeters } from '../components/AgentUsageMeters';
import { settingsCellBackground } from '../components/settings/SettingsList';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';

export function AgentAccountsScreen({ deviceId }: { deviceId: string }) {
  const theme = useTheme();
  const runtime = useRuntime();
  const [snapshot, setSnapshot] = useState<AgentAccountsSnapshot | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [login, setLogin] = useState<AgentLoginStart | undefined>(undefined);
  const [code, setCode] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const client = useMemo(
    () =>
      runtime === null
        ? undefined
        : agentAccountsClient(runtime.relayFor(deviceId)),
    [runtime, deviceId],
  );

  const refresh = useCallback(
    (trigger: AccountsLoadTrigger) => {
      client
        ?.list(forceUsageFor(trigger))
        .then(s => {
          setSnapshot(s);
          setError(undefined);
        })
        .catch(e => setError(String(e?.message ?? e)));
    },
    [client],
  );

  useEffect(() => {
    refresh('mount');
  }, [refresh]);

  const cancelLogin = useCallback(() => {
    if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    if (login !== undefined) client?.cancelLogin(login.loginId).catch(() => {});
    setLogin(undefined);
    setCode('');
  }, [client, login]);

  const poll = useCallback(
    (loginId: string) => {
      const tick = () => {
        client
          ?.pollLogin(loginId)
          .then(p => {
            if (p.status === 'done') {
              setLogin(undefined);
              refresh('postLogin');
              return;
            }
            if (p.status === 'error') {
              setError(p.message ?? 'login failed');
              setLogin(undefined);
              return;
            }
            if (p.url !== undefined)
              WebBrowser.openBrowserAsync(p.url).catch(() => {});
            pollTimer.current = setTimeout(tick, 2000);
          })
          .catch(() => {
            pollTimer.current = setTimeout(tick, 4000);
          });
      };
      pollTimer.current = setTimeout(tick, 2000);
    },
    [client, refresh],
  );

  const startLogin = useCallback(
    (harness: string) => {
      client
        ?.startLogin(harness)
        .then(start => {
          setLogin(start);
          if (start.mode === 'browser') {
            WebBrowser.openBrowserAsync(start.url).catch(() => {});
            poll(start.loginId);
          }
        })
        .catch(e => setError(String(e?.message ?? e)));
    },
    [client, poll],
  );

  const completeLogin = useCallback(() => {
    if (login === undefined) return;
    client
      ?.completeLogin(login.loginId, code.trim())
      .then(() => {
        setLogin(undefined);
        setCode('');
        refresh('postLogin');
      })
      .catch(e => setError(String(e?.message ?? e)));
  }, [client, login, code, refresh]);

  const onSwitch = useCallback(
    (harness: string, accountId: string) => {
      client
        ?.activate(harness, accountId)
        .then(() => refresh('postAction'))
        .catch(e => setError(String(e?.message ?? e)));
    },
    [client, refresh],
  );

  const onForget = useCallback(
    (harness: string, accountId: string) => {
      Alert.alert(t('accounts.forgetConfirm'), undefined, [
        { text: t('session.cancel'), style: 'cancel' },
        {
          text: t('accounts.forget'),
          style: 'destructive',
          onPress: () =>
            client
              ?.forget(harness, accountId)
              .then(() => refresh('postAction'))
              .catch(e => setError(String(e?.message ?? e))),
        },
      ]);
    },
    [client, refresh],
  );

  return (
    // View, not ScrollView — embedded inside the Settings page scroll.
    <View style={styles.root}>
      {error !== undefined ? (
        <Text style={[styles.err, { color: theme.danger }]}>{error}</Text>
      ) : null}
      {snapshot?.warnings.map((w, i) => (
        <Text key={i} style={[styles.warn, { color: theme.textSecondary }]}>
          {`${w.harness}: ${w.message}`}
        </Text>
      ))}
      {PROVIDERS.map(p => {
        const accounts = (snapshot?.accounts ?? []).filter(
          a => a.harness === p.harness,
        );
        return (
          <View
            key={p.harness}
            testID="agent-account-card"
            style={[
              styles.card,
              { backgroundColor: settingsCellBackground(theme) },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {p.name}
              </Text>
              <Pressable
                onPress={() => startLogin(p.harness)}
                disabled={login !== undefined}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('accounts.add')} ${p.name}`}
                style={styles.smallBtn}
              >
                <Text style={[styles.linkText, { color: theme.accent }]}>
                  {t('accounts.add')}
                </Text>
              </Pressable>
            </View>
            {accounts.map(a => (
              <View key={a.id} style={styles.account}>
                <Text
                  style={[styles.accountName, { color: theme.text }]}
                  maxFontSizeMultiplier={1.6}
                >
                  {a.displayName ?? a.email ?? a.id}
                  {a.planLabel !== undefined ? ` · ${a.planLabel}` : ''}
                  {a.active ? ` · ${t('accounts.active')}` : ''}
                </Text>
                <AgentUsageMeters windows={a.usageWindows} />
                {!a.active && a.switchable ? (
                  <View style={styles.accountActions}>
                    <Pressable
                      onPress={() => onSwitch(p.harness, a.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('accounts.switch')} ${
                        a.email ?? a.id
                      }`}
                      style={styles.smallBtn}
                    >
                      <Text style={[styles.linkText, { color: theme.accent }]}>
                        {t('accounts.switch')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onForget(p.harness, a.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('accounts.forget')} ${
                        a.email ?? a.id
                      }`}
                      style={styles.smallBtn}
                    >
                      <Text style={[styles.linkText, { color: theme.danger }]}>
                        {t('accounts.forget')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}

      {/* Login flow */}
      {login !== undefined ? (
        <View
          style={[
            styles.card,
            { backgroundColor: settingsCellBackground(theme) },
          ]}
        >
          {login.mode === 'paste-code' ? (
            <>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {t('accounts.pasteCode')}
              </Text>
              <Pressable
                onPress={() =>
                  WebBrowser.openBrowserAsync(login.url).catch(() => {})
                }
                accessibilityRole="link"
                accessibilityLabel={login.url}
              >
                <Text style={[styles.linkText, { color: theme.accent }]}>
                  {login.url}
                </Text>
              </Pressable>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="code"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.codeInput,
                  { color: theme.text, borderColor: theme.border },
                ]}
                accessibilityLabel={t('accounts.pasteCode')}
              />
              <View style={styles.accountActions}>
                <Pressable
                  onPress={completeLogin}
                  disabled={code.trim() === ''}
                  accessibilityRole="button"
                  accessibilityLabel={t('accounts.completeLogin')}
                  style={styles.smallBtn}
                >
                  <Text style={[styles.linkText, { color: theme.accent }]}>
                    {t('accounts.completeLogin')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={cancelLogin}
                  accessibilityRole="button"
                  accessibilityLabel={t('accounts.cancelLogin')}
                  style={styles.smallBtn}
                >
                  <Text
                    style={[styles.linkText, { color: theme.textSecondary }]}
                  >
                    {t('accounts.cancelLogin')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.pollRow}>
              <ActivityIndicator size="small" />
              <Text style={[styles.linkText, { color: theme.text }]}>
                {t('accounts.completeLogin')}…
              </Text>
              <Pressable
                onPress={cancelLogin}
                accessibilityRole="button"
                accessibilityLabel={t('accounts.cancelLogin')}
                style={styles.smallBtn}
              >
                <Text style={{ color: theme.textSecondary }}>
                  {t('accounts.cancelLogin')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  err: { fontSize: 13, padding: 8 },
  warn: { fontSize: 12, padding: 4 },
  card: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    overflow: 'hidden',
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  account: { gap: 4, paddingVertical: 4 },
  accountName: { fontSize: 14 },
  accountActions: { flexDirection: 'row', gap: 16 },
  smallBtn: { minHeight: 44, justifyContent: 'center' },
  codeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    fontFamily: 'monospace',
  },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkText: { fontSize: 13 },
});
