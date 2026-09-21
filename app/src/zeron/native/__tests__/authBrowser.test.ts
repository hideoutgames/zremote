import * as WebBrowser from 'expo-web-browser';
import {
  AUTH_CALLBACK_URL,
  httpsAuthCallbackUrl,
  openAuthSession,
  openAuthSessionOrBrowser,
} from '../authBrowser';

const AUTHORIZE =
  'https://api.workos.com/user_management/authorize?client_id=c';
const HTTPS_CALLBACK = 'https://edge.test/auth/cli/callback';

describe('openAuthSession', () => {
  beforeEach(() => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
  });

  test('custom-scheme callbacks do not opt into HTTPS universal links', async () => {
    await openAuthSession(AUTHORIZE, AUTH_CALLBACK_URL);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      AUTHORIZE,
      AUTH_CALLBACK_URL,
      { preferEphemeralSession: false, preferUniversalLinks: false },
    );
  });

  test('defaults the callback to zeron:// so the WorkOS sheet can start', async () => {
    await openAuthSession(AUTHORIZE);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      AUTHORIZE,
      AUTH_CALLBACK_URL,
      { preferEphemeralSession: false, preferUniversalLinks: false },
    );
  });

  test('httpsAuthCallbackUrl strips trailing slashes', () => {
    expect(httpsAuthCallbackUrl('https://edge.test/')).toBe(HTTPS_CALLBACK);
    expect(httpsAuthCallbackUrl('https://edge.test')).toBe(HTTPS_CALLBACK);
  });
});

describe('openAuthSessionOrBrowser', () => {
  beforeEach(() => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
  });

  test('starts AuthSession with zeron://, not the HTTPS WorkOS redirect', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?code=c&state=s`,
    });
    const result = await openAuthSessionOrBrowser(AUTHORIZE);
    expect(result).toEqual({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?code=c&state=s`,
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      AUTHORIZE,
      AUTH_CALLBACK_URL,
      { preferEphemeralSession: false, preferUniversalLinks: false },
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  test('does not treat cancel as a start failure', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({
      type: 'cancel',
    });
    const result = await openAuthSessionOrBrowser(AUTHORIZE);
    expect(result).toEqual({ type: 'cancel' });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  test('falls back to Safari when AuthSession fails to start', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValue(
      new Error('failed to start'),
    );
    const result = await openAuthSessionOrBrowser(AUTHORIZE);
    expect(result.type).toBe('dismiss');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(AUTHORIZE);
  });
});
