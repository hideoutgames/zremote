// Sign-in: ASWebAuthenticationSession / HTTPS callback with PKCE. Demo
// remains under Advanced. Expo Go cannot receive universal links — production
// sign-in is the HTTPS session on a dev/production build.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { openAuthSession } from '../zeron/native/authBrowser';
import { appConfig } from '../zeron/native/appConfig';
import { parseCallbackUrl } from '../zeron/auth/authKit';
import { randomBytes, sha256 } from '../zeron/native/expoCrypto';
import { useAuthSession } from '../app/runtimeContext';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { enterDemo } from '../demo/demoMode';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

const PKCE_ENABLED = true;

const isExpoGo = Constants.executionEnvironment === 'storeClient';

export function SignInScreen() {
  const theme = useTheme();
  const auth = useAuthSession();
  const edgeUrl = appConfig().edgeUrl;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await auth.beginSignIn({
        redirectUri: `${edgeUrl}/auth/cli/callback`,
        pkce: PKCE_ENABLED,
        random: randomBytes,
        sha256,
      });
      if (isExpoGo) {
        // Universal links can't land back in Expo Go. The zeron:// listener
        // in ZeronApp remains a second return path; otherwise tap Sign in
        // again from a development build.
        await WebBrowser.openBrowserAsync(url).catch(() => {});
        return;
      }
      const result = await openAuthSession(url, `${edgeUrl}/auth/cli/callback`);
      if (result.type === 'success') {
        const link = parseCallbackUrl(result.url);
        if (link.error !== undefined || link.code === undefined) {
          setError(t('signIn.error.generic'));
          return;
        }
        await auth.completeSignIn({
          code: link.code,
          state: link.state ?? '',
        });
      } else if (result.type !== 'cancel') {
        setError(t('signIn.error.generic'));
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`sign-in failed (${name})`);
      setError(t('signIn.error.generic'));
    } finally {
      setBusy(false);
    }
  }, [auth, edgeUrl]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>
        {t('signIn.title')}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        {t('signIn.subtitle')}
      </Text>

      <Pressable onPress={signIn} disabled={busy} hitSlop={8}>
        <Glass interactive style={styles.primary}>
          <Text style={[styles.primaryText, { color: theme.sendActive }]}>
            {t('signIn.button')}
          </Text>
        </Glass>
      </Pressable>

      {error !== null ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}

      <Pressable
        style={styles.advancedToggle}
        onPress={() => setAdvanced(a => !a)}
        hitSlop={8}
      >
        <Icon name="chevron.down" size={12} color={theme.textSecondary} />
        <Text style={[styles.advancedText, { color: theme.textSecondary }]}>
          {t('signIn.advanced')}
        </Text>
      </Pressable>
      {advanced ? (
        <View style={styles.advancedBox}>
          <Text style={[styles.edge, { color: theme.textSecondary }]}>
            {`${t('signIn.edgeUrl')}: ${edgeUrl}`}
          </Text>
          <Pressable onPress={enterDemo} hitSlop={8}>
            <Glass interactive style={styles.demoButton}>
              <Text style={[styles.demoText, { color: theme.sendActive }]}>
                {t('signIn.demo.button')}
              </Text>
            </Glass>
          </Pressable>
          <Text style={[styles.demoHint, { color: theme.textSecondary }]}>
            {t('signIn.demo.hint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { fontSize: 15, textAlign: 'center' },
  primary: {
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingVertical: 12,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryText: { fontSize: 17, fontWeight: '600' },
  error: { fontSize: 13 },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
  },
  advancedText: { fontSize: 13 },
  advancedBox: { alignItems: 'center', gap: 10, marginTop: 4 },
  edge: { fontSize: 12, fontFamily: 'Menlo' },
  demoButton: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'center',
    overflow: 'hidden',
  },
  demoText: { fontSize: 15, fontWeight: '600' },
  demoHint: { fontSize: 12, textAlign: 'center', lineHeight: 16 },
});
