// AuthKit browser shell: ASWebAuthenticationSession via expo-web-browser
// (https callback preferred — the edge serves apple-app-site-association),
// plus expo-linking for cold-start and foregrounded callback URLs.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export type AuthBrowserResult =
  | { type: 'success'; url: string }
  | { type: 'cancel' | 'dismiss' };

export const openAuthSession = async (
  url: string,
  redirectUrl: string,
): Promise<AuthBrowserResult> => {
  // HTTPS callbacks must use the iOS 17.4+ `.https(host:path:)` API.
  // The default (`preferUniversalLinks: false`) passes scheme "https" into
  // the legacy callbackURLScheme initializer, which fails to start and
  // surfaces as an instant Sign-in error with no browser.
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl, {
    preferEphemeralSession: false,
    preferUniversalLinks: true,
  });
  if (result.type === 'success') return { type: 'success', url: result.url };
  return { type: result.type === 'cancel' ? 'cancel' : 'dismiss' };
};

export const getInitialUrl = (): Promise<string | null> =>
  Linking.getInitialURL();

export const addUrlListener = (
  cb: (url: string) => void,
): { remove(): void } => {
  const sub = Linking.addEventListener('url', e => cb(e.url));
  return { remove: () => sub.remove() };
};
