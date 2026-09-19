// Sign-in: ASWebAuthenticationSession / HTTPS callback with PKCE. Demo
// remains under Advanced. Expo Go cannot receive universal links — production
// sign-in is the HTTPS session on a dev/production build; paste-code is the
// completable path when the browser cannot return here.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { openAuthSession } from '../zeron/native/authBrowser';
import { appConfig } from '../zeron/native/appConfig';
import { parseCallbackUrl } from '../zeron/auth/authKit';
import { randomBytes, sha256 } from '../zeron/native/expoCrypto';
import { useAuthSession } from '../app/runtimeContext';
import { GlassControl } from '../components/Glass';
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
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const edgeUrl = appConfig().edgeUrl;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState('');

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
        // Universal links can't land back in Expo Go. Paste the code the
        // callback page shows; the zeron:// listener remains a second path.
        await WebBrowser.openBrowserAsync(url).catch(() => {});
        setShowPaste(true);
        return;
      }
      const result = await openAuthSession(url, `${edgeUrl}/auth/cli/callback`);
      if (result.type === 'success') {
        const link = parseCallbackUrl(result.url);
        if (link.error !== undefined || link.code === undefined) {
          setError(t('signIn.error.generic'));
          setShowPaste(true);
          return;
        }
        await auth.completeSignIn({
          code: link.code,
          state: link.state ?? '',
        });
        return;
      }
      if (result.type !== 'cancel') {
        setError(t('signIn.error.generic'));
      }
      setShowPaste(true);
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`sign-in failed (${name})`);
      setError(t('signIn.error.generic'));
      setShowPaste(true);
    } finally {
      setBusy(false);
    }
  }, [auth, edgeUrl]);

  const completePaste = useCallback(async () => {
    if (paste.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await auth.completePastedCode(paste);
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`paste sign-in failed (${name})`);
      setError(t('signIn.error.generic'));
    } finally {
      setBusy(false);
    }
  }, [auth, paste]);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + 24,
        },
      ]}
    >
      <Text style={[styles.title, { color: theme.text }]}>
        {t('signIn.title')}
      </Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        {t('signIn.subtitle')}
      </Text>

      <GlassControl
        interactive
        onPress={signIn}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('signIn.button')}
        style={styles.primary}
      >
        <Text style={[styles.primaryText, { color: theme.sendActive }]}>
          {t('signIn.button')}
        </Text>
      </GlassControl>

      {error !== null ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}

      {showPaste ? (
        <View style={styles.pasteBox}>
          <Text style={[styles.pasteTitle, { color: theme.text }]}>
            {t('signIn.pasteFallback.title')}
          </Text>
          <Text style={[styles.pasteBody, { color: theme.textSecondary }]}>
            {isExpoGo
              ? t('signIn.pasteFallback.expoGo')
              : t('signIn.pasteFallback.body')}
          </Text>
          <TextInput
            value={paste}
            onChangeText={setPaste}
            placeholder={t('signIn.pasteFallback.placeholder')}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={[
              styles.pasteInput,
              { color: theme.text, backgroundColor: theme.inputBackground },
            ]}
            accessibilityLabel={t('signIn.pasteFallback.placeholder')}
          />
          <GlassControl
            interactive
            onPress={completePaste}
            disabled={busy || paste.trim() === ''}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('signIn.pasteFallback.continue')}
            style={styles.demoButton}
          >
            <Text style={[styles.demoText, { color: theme.sendActive }]}>
              {t('signIn.pasteFallback.continue')}
            </Text>
          </GlassControl>
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
        <View style={styles.advancedBox}>
          <Text style={[styles.edge, { color: theme.textSecondary }]}>
            {`${t('signIn.edgeUrl')}: ${edgeUrl}`}
          </Text>
          <GlassControl
            interactive
            onPress={enterDemo}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('signIn.demo.button')}
            style={styles.demoButton}
          >
            <Text style={[styles.demoText, { color: theme.sendActive }]}>
              {t('signIn.demo.button')}
            </Text>
          </GlassControl>
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
    minHeight: 44,
    alignItems: 'center',
    overflow: 'hidden',
  },
  primaryText: { fontSize: 17, fontWeight: '600' },
  error: { fontSize: 13 },
  pasteBox: { alignItems: 'center', gap: 8, width: '100%', maxWidth: 360 },
  pasteTitle: { fontSize: 15, fontWeight: '600' },
  pasteBody: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  pasteInput: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: 'Menlo',
  },
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
    minHeight: 36,
    alignItems: 'center',
    overflow: 'hidden',
  },
  demoText: { fontSize: 15, fontWeight: '600' },
  demoHint: { fontSize: 12, textAlign: 'center', lineHeight: 16 },
});
