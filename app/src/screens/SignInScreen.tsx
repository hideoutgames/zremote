// Sign-in: WorkOS redirect stays the registered HTTPS URI; AuthSession
// listens on zeron:// so the sheet actually presents. The edge 302-hops
// to that scheme. Authorize + exchange match the Zeron engine (no PKCE —
// the edge holds the client secret). If the hop is missing or the sheet is
// dismissed, paste the Copy-code page value (or the callback URL) to
// complete.

import React, { useCallback, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  httpsAuthCallbackUrl,
  openAuthSessionOrBrowser,
} from '../zeron/native/authBrowser';
import { appConfig } from '../zeron/native/appConfig';
import { parseCallbackUrl } from '../zeron/auth/authKit';
import { authFailureLog } from '../zeron/auth/authClient';
import { randomBytes, sha256 } from '../zeron/native/expoCrypto';
import { useAuthSession } from '../app/runtimeContext';
import { useTheme } from '../theme';
import { t } from '../i18n/strings';
import { createLog } from '../zeron/log';

const log = createLog();

const MARK_WHITE: number = require('../../assets/brand/zremote-mark-white.png');
const MARK_BLACK: number = require('../../assets/brand/zremote-mark-black.png');

/** Match the engine / iOS AuthClient: no code_challenge. PKCE helpers stay
 *  in authKit for a later re-enable once edge patch 0001 is confirmed. */
const PKCE_ENABLED = false;
/** Keep Continue visible above the keyboard, not only the TextInput. */
const PASTE_KEYBOARD_BOTTOM_OFFSET = 80;

const pasteFromCallback = (code: string, state: string): string =>
  `${state}.${code}`;

export function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const edgeUrl = appConfig().edgeUrl;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState('');

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const httpsCallback = httpsAuthCallbackUrl(edgeUrl);
      const { url } = await auth.beginSignIn({
        redirectUri: httpsCallback,
        pkce: PKCE_ENABLED,
        random: randomBytes,
        sha256,
      });
      const result = await openAuthSessionOrBrowser(url);
      if (result.type === 'success') {
        const link = parseCallbackUrl(result.url);
        if (link.error !== undefined || link.code === undefined) {
          setError(t('signIn.error.generic'));
          setShowPaste(true);
          return;
        }
        try {
          await auth.completeSignIn({
            code: link.code,
            state: link.state ?? '',
          });
          return;
        } catch (e) {
          log.warn(`sign-in failed (${authFailureLog(e)})`);
          setError(t('signIn.error.generic'));
          if (link.state !== undefined) {
            setPaste(pasteFromCallback(link.code, link.state));
          }
          setShowPaste(true);
          return;
        }
      }
      if (result.type !== 'cancel') {
        setError(t('signIn.error.generic'));
      }
      setShowPaste(true);
    } catch (e) {
      log.warn(`sign-in failed (${authFailureLog(e)})`);
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
      log.warn(`paste sign-in failed (${authFailureLog(e)})`);
      setError(t('signIn.error.generic'));
    } finally {
      setBusy(false);
    }
  }, [auth, paste]);

  const pasteReady = paste.trim() !== '';

  return (
    <KeyboardAwareScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.root,
        {
          paddingTop: insets.top + 24,
          paddingBottom: 24 + insets.bottom,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      bottomOffset={PASTE_KEYBOARD_BOTTOM_OFFSET}
      mode="layout"
    >
      <View style={styles.hero}>
        <Image
          source={theme.scheme === 'dark' ? MARK_WHITE : MARK_BLACK}
          style={styles.logo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={t('signIn.logo')}
        />
      </View>

      <View style={styles.bottom}>
        {error !== null ? (
          <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
        ) : null}

        {showPaste ? (
          <View style={styles.pasteBox}>
            <TextInput
              value={paste}
              onChangeText={setPaste}
              placeholder={t('signIn.pasteFallback.placeholder')}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={completePaste}
              style={[
                styles.pasteInput,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.inputBackground,
                },
              ]}
              accessibilityLabel={t('signIn.pasteFallback.placeholder')}
            />
            <Pressable
              onPress={completePaste}
              disabled={busy || !pasteReady}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('signIn.pasteFallback.continue')}
              accessibilityState={{ disabled: busy || !pasteReady }}
              style={[
                styles.continue,
                {
                  backgroundColor: theme.accent,
                  opacity: busy || !pasteReady ? 0.4 : 1,
                },
              ]}
            >
              <Text style={styles.continueText}>
                {t('signIn.pasteFallback.continue')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={signIn}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('signIn.button')}
          accessibilityState={{ disabled: busy }}
          style={[
            styles.primary,
            { backgroundColor: theme.accent, opacity: busy ? 0.4 : 1 },
          ]}
        >
          <Text style={styles.primaryText}>{t('signIn.button')}</Text>
        </Pressable>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  root: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  hero: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 53, height: 96 },
  bottom: {
    alignItems: 'center',
    gap: 12,
    width: '100%',
    paddingBottom: 8,
  },
  primary: {
    borderRadius: 25,
    paddingHorizontal: 32,
    minHeight: 50,
    minWidth: 220,
    alignSelf: 'center',
    flexGrow: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  error: { fontSize: 13, textAlign: 'center' },
  pasteBox: { alignItems: 'center', gap: 10, width: '100%', maxWidth: 360 },
  pasteInput: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: 'Menlo',
  },
  continue: {
    borderRadius: 22,
    paddingHorizontal: 24,
    minHeight: 44,
    alignSelf: 'center',
    flexGrow: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
});
