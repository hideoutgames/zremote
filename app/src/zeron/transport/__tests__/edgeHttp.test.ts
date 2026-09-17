// edgeHttp: bearer attach, 401 → onAuthFailure → one retry, EdgeHttpError,
// redactUrl token stripping.

import { edgeFetch, edgeFetchJson, EdgeHttpError } from '../edgeHttp';
import { redactUrl } from '../edge';
import { staticTokenSource, type TokenSource } from '../tokenSource';
import { fakeFetch } from '../../testing/fakeWs';

describe('edgeFetch', () => {
  test('attaches the bearer header', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ text: async () => '{}' }));
    await edgeFetch(
      'https://e.test/x',
      staticTokenSource('tok'),
      {},
      fetchImpl,
    );
    expect(calls[0].init.headers?.Authorization).toBe('Bearer tok');
  });

  test('401 fires onAuthFailure once and retries with the fresh token', async () => {
    let failures = 0;
    let token = 'old';
    const source: TokenSource = {
      currentToken: async () => token,
      onAuthFailure: () => {
        failures += 1;
        token = 'new';
      },
    };
    const seen: (string | undefined)[] = [];
    const { fetchImpl } = fakeFetch((_url, init) => {
      seen.push(init.headers?.Authorization);
      return { status: seen.length === 1 ? 401 : 200, text: async () => 'ok' };
    });
    const res = await edgeFetch('https://e.test/x', source, {}, fetchImpl);
    expect(res.status).toBe(200);
    expect(failures).toBe(1);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  test('a repeated 401 is NOT retried again', async () => {
    const source: TokenSource = {
      currentToken: async () => 't',
      onAuthFailure: () => {},
    };
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 401 }));
    const res = await edgeFetch('https://e.test/x', source, {}, fetchImpl);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(2); // first + the one retry
  });

  test('edgeFetchJson throws EdgeHttpError on non-2xx', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 500,
      text: async () => 'nope',
    }));
    await expect(
      edgeFetchJson('https://e.test/x', staticTokenSource('t'), {}, fetchImpl),
    ).rejects.toThrow(EdgeHttpError);
  });
});

describe('redactUrl', () => {
  test('strips token params, keeps the rest', () => {
    expect(redactUrl('wss://e.test/r?device=d1&token=sekret')).toBe(
      'wss://e.test/r?device=d1',
    );
    expect(redactUrl('wss://e.test/r?token=sekret')).toBe('wss://e.test/r');
    expect(redactUrl('wss://e.test/r?device=d1')).toBe(
      'wss://e.test/r?device=d1',
    );
    expect(redactUrl('wss://e.test/r')).toBe('wss://e.test/r');
  });
});
