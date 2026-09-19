// AuthKit browser shell: ASWebAuthenticationSession via expo-web-browser.
// Primary: zeron:// so the sheet actually presents. HTTPS AuthSession with
// preferUniversalLinks silently cancels without verified AASA/webcredentials
// and never opens api.workos.com. WorkOS still redirects to the registered
// HTTPS URI; the edge 302-hops to zeron://. expo-linking covers Safari
// returns if AuthSession fails to start.

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
  redirectUrl: string = AUTH_CALLBACK_URL,
): Promise<AuthBrowserResult> => {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl, {
    preferEphemeralSession: false,
    preferUniversalLinks: false,
  });
  if (result.type === 'success') return { type: 'success', url: result.url };
  return { type: result.type === 'cancel' ? 'cancel' : 'dismiss' };
};

/** Custom-scheme AuthSession so WorkOS actually presents. If start throws,
 * open Safari and let Linking finish. `{ type: 'cancel' }` is the user
 * tapping Done — do not treat it as a start failure. */
export const openAuthSessionOrBrowser = async (
  url: string,
  schemeRedirect: string = AUTH_CALLBACK_URL,
): Promise<AuthBrowserResult> => {
  try {
    return await openAuthSession(url, schemeRedirect);
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
