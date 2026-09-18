// Sign-in: browser auth session → code exchange; paste-code fallback when the
// browser doesn't return; collapsed Advanced section with the edge URL.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { openAuthSession } from '../zeron/native/authBrowser';
import { appConfig } from '../zeron/native/appConfig';
import { useAuthSession } from '../app/runtimeContext';
import { Glass } from '../components/Glass';
import { Icon } from '../components/Icon';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

// The edge doesn't accept a PKCE verifier yet — flag kept for when it does.
const PKCE_ENABLED = false;

// Expo Go can't receive universal-link callbacks — sign-in is paste-code only.
const isExpoGo = Constants.executionEnvironment === 'storeClient';

export function SignInScreen() {
  const theme = useTheme();
  const auth = useAuthSession();
  const edgeUrl = appConfig().edgeUrl;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await auth.beginSignIn({
        redirectUri: `${edgeUrl}/auth/cli/callback`,
        pkce: PKCE_ENABLED,
      });
      if (isExpoGo) {
        // Universal links can't land back in Expo Go — open the AuthKit URL
        // and wait for the user to paste the code.
        await WebBrowser.openBrowserAsync(url).catch(() => {});
        setPasteOpen(true);
        return;
      }
      const result = await openAuthSession(url, `${edgeUrl}/auth/cli/callback`);
      if (result.type === 'success') {
        const link = new URL(result.url);
        await auth.completeSignIn({
          code: link.searchParams.get('code') ?? '',
          state: link.searchParams.get('state') ?? '',
        });
      } else {
        setPasteOpen(true);
      }
    } catch (e) {
      log.warn(`sign-in failed: ${e}`);
      setError(t('signIn.error.generic'));
      setPasteOpen(true);
    } finally {
      setBusy(false);
    }
  }, [auth, edgeUrl]);

  const submitPaste = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.completePastedCode(paste.trim());
    } catch (e) {
      log.warn(`pasted code rejected: ${e}`);
      setError(t('signIn.error.generic'));
    } finally {
      setBusy(false);
    }
  }, [auth, paste]);

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

      {pasteOpen ? (
        <View style={styles.pasteBox}>
          {isExpoGo ? (
            <Text style={[styles.pasteBody, { color: theme.textSecondary }]}>
              {t('signIn.pasteFallback.expoGo')}
            </Text>
          ) : null}
          <Text style={[styles.pasteTitle, { color: theme.text }]}>
            {t('signIn.pasteFallback.title')}
          </Text>
          <Text style={[styles.pasteBody, { color: theme.textSecondary }]}>
            {t('signIn.pasteFallback.body')}
          </Text>
          <TextInput
            value={paste}
            onChangeText={setPaste}
            placeholder={t('signIn.pasteFallback.placeholder')}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.pasteInput,
              {
                color: theme.text,
                backgroundColor: theme.inputBackground,
                borderColor: theme.border,
              },
            ]}
          />
          <Pressable
            onPress={submitPaste}
            disabled={busy || paste.trim() === ''}
            hitSlop={8}
          >
            <Glass interactive style={styles.primary}>
              <Text style={[styles.primaryText, { color: theme.sendActive }]}>
                {t('signIn.pasteFallback.continue')}
              </Text>
            </Glass>
          </Pressable>
        </View>
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
        <Text style={[styles.edge, { color: theme.textSecondary }]}>
          {`${t('signIn.edgeUrl')}: ${edgeUrl}`}
        </Text>
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
  pasteBox: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  pasteTitle: { fontSize: 15, fontWeight: '600' },
  pasteBody: { fontSize: 13, lineHeight: 18 },
  pasteInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
  },
  advancedText: { fontSize: 13 },
  edge: { fontSize: 12, fontFamily: 'Menlo' },
});
