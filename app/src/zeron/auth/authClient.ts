// Ported from zeron@853872d apps/ios/Zeron/Auth/AuthClient.swift and
// crates/engine/src/auth.rs (exchange/refresh/orgs wire shapes).
//
// Edge auth client — /auth/exchange, /auth/refresh, /auth/orgs. Two modes:
// - WorkOS: paste-code exchange → access/refresh tokens; refresh scoped to
//   an org adds the org_id claim the workspace room requires.
// - Dev (AUTH_MODE=dev edge): the bearer string IS the user id; "user@org"
//   supplies a fake org claim.

import type { FetchImpl, FetchResponse } from '../transport/edgeHttp';

export interface AuthUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthOrg {
  id: string;
  organizationId: string;
  name: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AuthError =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'invalidResponse' }
  | { kind: 'unreachable'; message: string };

export class AuthRequestError extends Error {
  constructor(readonly detail: AuthError) {
    super(
      detail.kind === 'http'
        ? `Auth failed (${detail.status}): ${detail.body}`
        : detail.kind === 'unreachable'
        ? `The edge is unreachable: ${detail.message}`
        : 'Unexpected auth response',
    );
    this.name = 'AuthRequestError';
  }
}

/** Log-safe label: kind + HTTP status. Never body, codes, or paste. */
export const authFailureLog = (e: unknown): string => {
  if (e instanceof AuthRequestError) {
    return e.detail.kind === 'http'
      ? `AuthRequestError http ${e.detail.status}`
      : `AuthRequestError ${e.detail.kind}`;
  }
  return e instanceof Error ? e.name : 'Error';
};

export interface AuthClientDeps {
  /** Edge base URL (e.g. https://edge.zeron.sh). */
  baseUrl: string;
  fetchImpl?: FetchImpl;
}

const defaultFetch: FetchImpl = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    // Uint8Array bodies are fine on RN fetch; the DOM lib types disagree.
    body: init.body as BodyInit | undefined,
  });
  return {
    status: res.status,
    headers: res.headers,
    arrayBuffer: () => res.arrayBuffer(),
    text: () => res.text(),
  };
};

export class AuthClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchImpl;

  constructor(deps: AuthClientDeps) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = deps.fetchImpl ?? defaultFetch;
  }

  /** POST /auth/exchange — WorkOS code → tokens. `codeVerifier` rides the
   * body ONLY when provided (the current edge ignores unknown fields; the
   * PKCE passthrough is a documented pending edge change). */
  async exchange(
    code: string,
    opts: { codeVerifier?: string } = {},
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const body: Record<string, string> = { code };
    if (opts.codeVerifier !== undefined) body.codeVerifier = opts.codeVerifier;
    const r = await this.post<{
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }>('auth/exchange', body);
    if (
      r.user == null ||
      typeof r.user.id !== 'string' ||
      typeof r.accessToken !== 'string' ||
      typeof r.refreshToken !== 'string'
    ) {
      throw new AuthRequestError({ kind: 'invalidResponse' });
    }
    return {
      user: r.user,
      tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken },
    };
  }

  /** POST /auth/refresh — org scope optional; the returned access token
   * carries `org_id` when an organizationId was passed. */
  async refresh(
    refreshToken: string,
    organizationId?: string,
  ): Promise<AuthTokens> {
    const body: Record<string, string> = { refreshToken };
    if (organizationId !== undefined) body.organizationId = organizationId;
    return this.post<AuthTokens>('auth/refresh', body);
  }

  /** GET /auth/orgs — the caller's active org memberships. */
  async orgs(accessToken: string): Promise<AuthOrg[]> {
    const res = await this.request('auth/orgs', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await this.checkedJson<{ orgs?: AuthOrg[] }>(res);
    return body.orgs ?? [];
  }

  /** POST /auth/orgs — create an org (the edge makes us its first admin
   * member); returns the new organization id. */
  async createOrg(accessToken: string, name: string): Promise<string> {
    const res = await this.request('auth/orgs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ name }),
    });
    const body = await this.checkedJson<{ organizationId?: string }>(res);
    if (typeof body.organizationId !== 'string') {
      throw new AuthRequestError({ kind: 'invalidResponse' });
    }
    return body.organizationId;
  }

  private post<T>(path: string, body: Record<string, string>): Promise<T> {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(res => this.checkedJson<T>(res));
  }

  private async request(
    path: string,
    init: Parameters<FetchImpl>[1],
  ): Promise<FetchResponse> {
    try {
      return await this.fetchImpl(
        `${this.baseUrl}/${path.replace(/^\/+/, '')}`,
        init,
      );
    } catch (error) {
      throw new AuthRequestError({
        kind: 'unreachable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async checkedJson<T>(res: FetchResponse): Promise<T> {
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new AuthRequestError({
        kind: 'http',
        status: res.status,
        body: text,
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AuthRequestError({ kind: 'invalidResponse' });
    }
  }
}
