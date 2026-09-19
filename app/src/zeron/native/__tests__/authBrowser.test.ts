import * as WebBrowser from 'expo-web-browser';
import {
  AUTH_CALLBACK_URL,
  openAuthSession,
  openAuthSessionOrBrowser,
} from '../authBrowser';

describe('openAuthSession', () => {
  beforeEach(() => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
  });

  test('custom-scheme callbacks do not opt into HTTPS universal links', async () => {
    const url = 'https://api.workos.com/user_management/authorize?client_id=c';
    await openAuthSession(url, AUTH_CALLBACK_URL);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      url,
      AUTH_CALLBACK_URL,
      { preferEphemeralSession: false, preferUniversalLinks: false },
    );
  });

  test('HTTPS callbacks still opt into iOS universal-link AuthSession', async () => {
    const url = 'https://api.workos.com/user_management/authorize?client_id=c';
    const redirect = 'https://edge.test/auth/cli/callback';
    await openAuthSession(url, redirect);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      url,
      redirect,
      { preferEphemeralSession: false, preferUniversalLinks: true },
    );
  });

  test('openAuthSessionOrBrowser falls back to Safari when AuthSession throws', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValueOnce(
      new Error('failed to start'),
    );
    const url = 'https://api.workos.com/user_management/authorize?client_id=c';
    const result = await openAuthSessionOrBrowser(url, AUTH_CALLBACK_URL);
    expect(result.type).toBe('dismiss');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(url);
  });
});
