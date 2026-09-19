// AuthKit browser shell: ASWebAuthenticationSession via expo-web-browser.
// Primary: HTTPS callback (iOS 17.4+ `.https(host:path:)` intercepts WorkOS
// landing on /auth/cli/callback). Fallback: zeron:// so iOS 17.0–17.3 can
// start; the edge 302-hops that scheme. expo-linking covers Safari returns.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export type AuthBrowserResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' };

export const AUTH_CALLBACK_URL = 'zeron://auth/callback';

export const httpsAuthCallbackUrl = (edgeUrl: string): string =>
  `${edgeUrl.replace(/\/+$/, '')}/auth/cli/callback`;

export const openAuthSession = async (
  url: string,
  redirectUrl: string,
): Promise<AuthBrowserResult> => {
  // HTTPS callbacks must use the iOS 17.4+ `.https(host:path:)` API
  // (preferUniversalLinks true). Custom-scheme callbacks use the legacy
  // initializer — that is what actually presents ASWebAuthenticationSession
  // on iOS 17.0–17.3, where scheme "https" fails to start.
  const https = redirectUrl.startsWith('https:');
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl, {
    preferEphemeralSession: false,
    preferUniversalLinks: https,
  });
  if (result.type === 'success') return { type: 'success', url: result.url };
  return { type: result.type === 'cancel' ? 'cancel' : 'dismiss' };
};

/** HTTPS AuthSession first (17.4+ intercepts the WorkOS landing URL). If
 * that fails to start, retry with `zeron://`. If that also fails, open
 * Safari and let Linking finish. */
export const openAuthSessionOrBrowser = async (
  url: string,
  httpsRedirect: string,
  schemeRedirect: string = AUTH_CALLBACK_URL,
): Promise<AuthBrowserResult> => {
  try {
    return await openAuthSession(url, httpsRedirect);
  } catch {
    try {
      return await openAuthSession(url, schemeRedirect);
    } catch {
      await WebBrowser.openBrowserAsync(url).catch(() => {});
      return { type: 'dismiss' };
    }
  }
};

export const getInitialUrl = (): Promise<string | null> =>
  Linking.getInitialURL();

export const addUrlListener = (
  cb: (url: string) => void,
): { remove(): void } => {
  const sub = Linking.addEventListener('url', e => cb(e.url));
  return { remove: () => sub.remove() };
};
