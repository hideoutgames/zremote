import * as WebBrowser from 'expo-web-browser';
import { openAuthSession } from '../authBrowser';

describe('openAuthSession', () => {
  beforeEach(() => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
  });

  test('HTTPS callbacks opt into iOS universal-link AuthSession', async () => {
    const url = 'https://api.workos.com/user_management/authorize?client_id=c';
    const redirect = 'https://edge.test/auth/cli/callback';
    await openAuthSession(url, redirect);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      url,
      redirect,
      { preferEphemeralSession: false, preferUniversalLinks: true },
    );
  });
});
