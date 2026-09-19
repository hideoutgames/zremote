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

  test('HTTPS callbacks still opt into iOS universal-link AuthSession', async () => {
    await openAuthSession(AUTHORIZE, HTTPS_CALLBACK);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      AUTHORIZE,
      HTTPS_CALLBACK,
      { preferEphemeralSession: false, preferUniversalLinks: true },
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

  test('tries the HTTPS callback first', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({
      type: 'success',
      url: `${HTTPS_CALLBACK}?code=c&state=s`,
    });
    const result = await openAuthSessionOrBrowser(AUTHORIZE, HTTPS_CALLBACK);
    expect(result).toEqual({
      type: 'success',
      url: `${HTTPS_CALLBACK}?code=c&state=s`,
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      AUTHORIZE,
      HTTPS_CALLBACK,
      { preferEphemeralSession: false, preferUniversalLinks: true },
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  test('retries zeron:// when HTTPS AuthSession fails to start', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock)
      .mockRejectedValueOnce(new Error('failed to start'))
      .mockResolvedValueOnce({
        type: 'success',
        url: `${AUTH_CALLBACK_URL}?code=c&state=s`,
      });
    const result = await openAuthSessionOrBrowser(AUTHORIZE, HTTPS_CALLBACK);
    expect(result).toEqual({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?code=c&state=s`,
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenNthCalledWith(
      1,
      AUTHORIZE,
      HTTPS_CALLBACK,
      { preferEphemeralSession: false, preferUniversalLinks: true },
    );
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenNthCalledWith(
      2,
      AUTHORIZE,
      AUTH_CALLBACK_URL,
      { preferEphemeralSession: false, preferUniversalLinks: false },
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  test('falls back to Safari when both AuthSessions fail to start', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValue(
      new Error('failed to start'),
    );
    const result = await openAuthSessionOrBrowser(AUTHORIZE, HTTPS_CALLBACK);
    expect(result.type).toBe('dismiss');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(2);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(AUTHORIZE);
  });
});
