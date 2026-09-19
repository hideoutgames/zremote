// AuthKit browser shell: ASWebAuthenticationSession via expo-web-browser
// with a custom-scheme return (`zeron://auth/callback`). WorkOS still
// redirects to the registered HTTPS URI; the edge hops iOS UAs to zeron://.
// expo-linking covers cold-start and fallback Safari returns.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export type AuthBrowserResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' };

export const AUTH_CALLBACK_URL = 'zeron://auth/callback';

export const openAuthSession = async (
  url: string,
  redirectUrl: string,
): Promise<AuthBrowserResult> => {
  // HTTPS callbacks must use the iOS 17.4+ `.https(host:path:)` API.
  // Custom-scheme callbacks use the legacy initializer (preferUniversalLinks
  // false) — that is what actually presents ASWebAuthenticationSession on
  // iOS 17.0+.
  const https = redirectUrl.startsWith('https:');
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl, {
    preferEphemeralSession: false,
    preferUniversalLinks: https,
  });
  if (result.type === 'success') return { type: 'success', url: result.url };
  return { type: result.type === 'cancel' ? 'cancel' : 'dismiss' };
};

/** AuthSession first; if it fails to start, open Safari and let Linking finish. */
export const openAuthSessionOrBrowser = async (
  url: string,
  redirectUrl: string,
): Promise<AuthBrowserResult> => {
  try {
    return await openAuthSession(url, redirectUrl);
  } catch {
    await WebBrowser.openBrowserAsync(url).catch(() => {});
    return { type: 'dismiss' };
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
