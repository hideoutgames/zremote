// authSession: sign-in state machine, org selection, single-flight refresh,
// 401 → signedOut, network-failure retry, cold-start restore, pasted codes,
// authorize URL exact shape, RFC 7636 PKCE vector. FakeClock + scripted
// fetch throughout.

import { createHash, randomBytes } from 'crypto';
import { AuthClient } from '../authClient';
import { AuthSession, DevAuthSession, type AuthState } from '../authSession';
import {
  buildAuthorizeUrl,
  challengeFor,
  decodeJwtPayload,
  generateVerifier,
  parseCallbackUrl,
  parsePastedCode,
  MOBILE_SIGN_IN_STATE_PREFIX,
} from '../authKit';
import { MemorySecureStore } from '../secureStore';
import { FakeClock } from '../../transport/clock';
import type { FetchImpl } from '../../transport/edgeHttp';

const BASE = 'https://edge.test';

const b64u = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) =>
  `${b64u({ alg: 'none' })}.${b64u(payload)}.${b64u({ s: 1 })}`;

const user = { id: 'u1', email: 'u@x.test' };

/** Scripted edge auth endpoints. */
const authFetch = (handler: {
  exchange?: (body: Record<string, string>) => {
    status?: number;
    json?: unknown;
  };
  refresh?: (body: Record<string, string>) => {
    status?: number;
    json?: unknown;
  };
  orgsGet?: () => { status?: number; json?: unknown };
  orgsPost?: (body: Record<string, string>) => {
    status?: number;
    json?: unknown;
  };
  throwOn?: 'exchange' | 'refresh';
}) => {
  const calls: { url: string; body?: Record<string, string> }[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, string>)
        : undefined;
    calls.push({ url, body });
    const pick = () => {
      if (url.endsWith('/auth/exchange')) {
        if (handler.throwOn === 'exchange') throw new Error('conn refused');
        return handler.exchange?.(body ?? {}) ?? { status: 500, json: {} };
      }
      if (url.endsWith('/auth/refresh')) {
        if (handler.throwOn === 'refresh') throw new Error('conn refused');
        return handler.refresh?.(body ?? {}) ?? { status: 500, json: {} };
      }
      if (url.endsWith('/auth/orgs')) {
        return init.method === 'POST'
          ? handler.orgsPost?.(body ?? {}) ?? { status: 500, json: {} }
          : handler.orgsGet?.() ?? { status: 500, json: {} };
      }
      return { status: 404, json: {} };
    };
    const r = pick();
    return {
      status: r.status ?? 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => JSON.stringify(r.json ?? {}),
    };
  };
  return { fetchImpl, calls };
};

const makeSession = (fetchImpl: FetchImpl, store = new MemorySecureStore()) => {
  const clock = new FakeClock(1_700_000_000_000);
  const client = new AuthClient({ baseUrl: BASE, fetchImpl });
  const session = new AuthSession({
    client,
    store,
    clock,
    baseUrl: BASE,
    clientId: 'client_abc',
  });
  return { session, clock, store };
};

const signedInTokens = (exp = 1_800_000_000, orgId = 'org_1') => ({
  user,
  accessToken: jwt({ sub: 'u1', org_id: orgId, exp }),
  refreshToken: 'rt1',
});

describe('authKit', () => {
  test('authorize URL matches the engine format exactly', () => {
    const url = buildAuthorizeUrl({
      clientId: 'client_abc',
      redirectUri: 'zeron://auth/callback',
      state: 'st123',
    });
    expect(url).toBe(
      'https://api.workos.com/user_management/authorize?response_type=code' +
        '&client_id=client_abc&redirect_uri=zeron%3A%2F%2Fauth%2Fcallback' +
        '&provider=authkit&state=st123',
    );
  });

  test('PKCE adds code_challenge + method', () => {
    const url = buildAuthorizeUrl({
      clientId: 'c',
      redirectUri: 'r',
      state: 's',
      codeChallenge: 'CH',
    });
    expect(url).toContain('&code_challenge=CH&code_challenge_method=S256');
  });

  test('parseCallbackUrl reads code/state/error', () => {
    expect(parseCallbackUrl('zeron://cb?code=abc&state=st')).toEqual({
      code: 'abc',
      state: 'st',
    });
    expect(parseCallbackUrl('zeron://cb?error=access_denied')).toEqual({
      error: 'access_denied',
    });
  });

  test('parsePastedCode splits on the first dot', () => {
    expect(parsePastedCode('st.ate.co.de')).toEqual({
      state: 'st',
      code: 'ate.co.de',
    });
    expect(parsePastedCode('noDot')).toBeUndefined();
    expect(parsePastedCode('.onlycode')).toBeUndefined();
    expect(parsePastedCode('onlystate.')).toBeUndefined();
  });

  test('parsePastedCode keeps the zr1. mobile prefix on state', () => {
    expect(parsePastedCode('zr1.abc.thecode')).toEqual({
      state: 'zr1.abc',
      code: 'thecode',
    });
  });

  test('RFC 7636 appendix B PKCE vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const sha256 = async (b: Uint8Array) =>
      new Uint8Array(createHash('sha256').update(b).digest());
    await expect(challengeFor(verifier, sha256)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const v = generateVerifier(n => new Uint8Array(randomBytes(n)));
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  test('decodeJwtPayload reads claims', () => {
    expect(decodeJwtPayload(jwt({ sub: 'u1', org_id: 'o9' }))).toMatchObject({
      sub: 'u1',
      org_id: 'o9',
    });
    expect(decodeJwtPayload('garbage')).toBeUndefined();
  });
});

describe('AuthSession sign-in', () => {
  test('begin → complete exchanges the code and lands signedIn on org_id claim', async () => {
    const { fetchImpl, calls } = authFetch({
      exchange: () => ({ json: signedInTokens() }),
    });
    const { session } = makeSession(fetchImpl);
    const { url, state } = await session.beginSignIn({
      redirectUri: 'zeron://cb',
      pkce: false,
    });
    expect(url).toContain('provider=authkit&state=');
    expect(state.startsWith(MOBILE_SIGN_IN_STATE_PREFIX)).toBe(true);
    const next = await session.completeSignIn({ code: 'thecode', state });
    expect(next).toEqual({ state: 'signedIn', user, orgId: 'org_1' });
    expect(calls.find(c => c.url.endsWith('/auth/exchange'))?.body).toEqual({
      code: 'thecode',
    });
  });

  test('state mismatch is rejected', async () => {
    const { fetchImpl } = authFetch({
      exchange: () => ({ json: signedInTokens() }),
    });
    const { session } = makeSession(fetchImpl);
    await session.beginSignIn({ redirectUri: 'zeron://cb', pkce: false });
    await expect(
      session.completeSignIn({ code: 'x', state: 'forged' }),
    ).rejects.toThrow();
  });

  test('no org_id → needsOrganization → selectOrg → signedIn', async () => {
    const noOrg = {
      user,
      accessToken: jwt({ sub: 'u1', exp: 1_800_000_000 }),
      refreshToken: 'rt1',
    };
    const { fetchImpl, calls } = authFetch({
      exchange: () => ({ json: noOrg }),
      refresh: body =>
        body.organizationId === 'org_2'
          ? { json: signedInTokens(1_800_000_000, 'org_2') }
          : { status: 400, json: {} },
    });
    const { session } = makeSession(fetchImpl);
    const { state } = await session.beginSignIn({
      redirectUri: 'zeron://cb',
      pkce: false,
    });
    expect(await session.completeSignIn({ code: 'c', state })).toEqual({
      state: 'needsOrganization',
      user,
    });
    const next = await session.selectOrg('org_2');
    expect(next).toEqual({ state: 'signedIn', user, orgId: 'org_2' });
    expect(calls.find(c => c.url.endsWith('/auth/refresh'))?.body).toEqual({
      refreshToken: 'rt1',
      organizationId: 'org_2',
    });
  });

  test('completePastedCode drives the same path', async () => {
    const { fetchImpl } = authFetch({
      exchange: () => ({ json: signedInTokens() }),
    });
    const { session } = makeSession(fetchImpl);
    const { state } = await session.beginSignIn({
      redirectUri: 'zeron://cb',
      pkce: false,
    });
    const next = await session.completePastedCode(`${state}.pastedcode`);
    expect(next.state).toBe('signedIn');
  });

  test('PKCE beginSignIn adds S256 challenge and exchanges the verifier', async () => {
    const { fetchImpl, calls } = authFetch({
      exchange: () => ({ json: signedInTokens() }),
    });
    const { session } = makeSession(fetchImpl);
    const sha256 = async (b: Uint8Array) =>
      new Uint8Array(createHash('sha256').update(b).digest());
    const { url, state } = await session.beginSignIn({
      redirectUri: 'https://edge.test/auth/cli/callback',
      pkce: true,
      random: n => new Uint8Array(randomBytes(n)),
      sha256,
    });
    expect(url).toContain('code_challenge=');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).not.toContain('code_challenge_method=S256&code_challenge=');
    const next = await session.completeSignIn({ code: 'thecode', state });
    expect(next.state).toBe('signedIn');
    const body = calls.find(c => c.url.endsWith('/auth/exchange'))?.body;
    expect(body?.code).toBe('thecode');
    expect(body?.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
  });
});

describe('AuthSession token lifecycle', () => {
  const seedStore = (store: MemorySecureStore, accessToken: string) =>
    store.set(
      `zeron.auth.${BASE}`,
      JSON.stringify({
        user,
        accessToken,
        refreshToken: 'rt1',
        orgId: 'org_1',
      }),
    );

  test('cold-start restore → signedIn with the cached token', async () => {
    const store = new MemorySecureStore();
    await seedStore(
      store,
      jwt({ sub: 'u1', org_id: 'org_1', exp: 1_800_000_000 }),
    );
    const { session } = makeSession(authFetch({}).fetchImpl, store);
    await session.restore();
    expect(session.state.state).toBe('signedIn');
    await expect(session.currentToken()).resolves.toContain('.');
  });

  test('expiring token → single-flight refresh (two callers, one request)', async () => {
    const store = new MemorySecureStore();
    const expired = jwt({ sub: 'u1', org_id: 'org_1', exp: 1_000 }); // long dead
    await seedStore(store, expired);
    let refreshes = 0;
    const { fetchImpl } = authFetch({
      refresh: () => {
        refreshes += 1;
        return { json: signedInTokens() };
      },
    });
    const { session } = makeSession(fetchImpl, store);
    const [a, b] = await Promise.all([
      session.currentToken(),
      session.currentToken(),
    ]);
    expect(a).toBe(b);
    expect(refreshes).toBe(1);
  });

  test('fresh token skips the refresh entirely', async () => {
    const store = new MemorySecureStore();
    await seedStore(
      store,
      jwt({ sub: 'u1', org_id: 'org_1', exp: 1_800_000_000 }),
    );
    let refreshes = 0;
    const { fetchImpl } = authFetch({
      refresh: () => {
        refreshes += 1;
        return { json: signedInTokens() };
      },
    });
    const { session } = makeSession(fetchImpl, store);
    // exp 1800000000s = now + ~100m; well outside the 30s slack.
    await expect(session.currentToken()).resolves.toContain('.');
    expect(refreshes).toBe(0);
  });

  test('refresh 401 → signedOut + storage cleared', async () => {
    const store = new MemorySecureStore();
    await seedStore(store, jwt({ sub: 'u1', org_id: 'org_1', exp: 1_000 }));
    const { fetchImpl } = authFetch({
      refresh: () => ({ status: 401, json: {} }),
    });
    const { session } = makeSession(fetchImpl, store);
    const states: AuthState['state'][] = [];
    session.subscribe(s => states.push(s.state));
    await expect(session.currentToken()).resolves.toBeUndefined();
    expect(session.state.state).toBe('signedOut');
    expect(states).toContain('signedOut');
    await expect(store.get(`zeron.auth.${BASE}`)).resolves.toBeUndefined();
  });

  test('refresh network failure → state kept, undefined token, retry scheduled', async () => {
    const store = new MemorySecureStore();
    await seedStore(store, jwt({ sub: 'u1', org_id: 'org_1', exp: 1_000 }));
    let calls = 0;
    const { fetchImpl } = authFetch({
      refresh: () => {
        calls += 1;
        if (calls === 1) throw new Error('conn refused');
        return { json: signedInTokens() };
      },
    });
    const { session, clock } = makeSession(fetchImpl, store);
    await expect(session.currentToken()).resolves.toBeUndefined();
    expect(session.state.state).toBe('signedIn');
    // Retry timer armed (1s backoff); firing it refreshes successfully.
    expect(clock.pendingCount).toBe(1);
    clock.advance(1_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    await expect(session.currentToken()).resolves.toContain('.');
  });
});

describe('DevAuthSession', () => {
  test('always signedIn; token is user@org', async () => {
    const dev = new DevAuthSession('u@x.test', 'org_dev');
    expect(dev.state).toEqual({
      state: 'signedIn',
      user: { id: 'u@x.test' },
      orgId: 'org_dev',
    });
    await expect(dev.currentToken()).resolves.toBe('u@x.test@org_dev');
  });
});
