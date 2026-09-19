// Ported from zeron@853872d crates/engine/src/auth.rs (AuthState, pending
// sign-in TTL, refresh single-flight via Shared, TOKEN_SLACK 30s, retry
// backoff 1s→5s, refresh 401 ⇒ signedOut + storage clear).

import {
  AuthClient,
  AuthRequestError,
  type AuthTokens,
  type AuthUser,
} from './authClient';
import {
  buildAuthorizeUrl,
  challengeFor,
  decodeJwtPayload,
  generateVerifier,
  parsePastedCode,
  MOBILE_SIGN_IN_STATE_PREFIX,
  type AuthorizeParams,
} from './authKit';
import type { SecureStorePort } from './secureStore';
import type { TokenSource } from '../transport/tokenSource';
import type { Clock } from '../transport/clock';
import { systemClock } from '../transport/clock';
import { createLog } from '../log';

export type AuthState =
  | { state: 'signedOut' }
  | { state: 'needsOrganization'; user: AuthUser }
  | { state: 'signedIn'; user: AuthUser; orgId: string };

const SIGN_IN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TOKEN_SLACK_MS = 30_000;
const REFRESH_RETRY_BASE_MS = 1_000;
const REFRESH_RETRY_MAX_MS = 5_000;
const STORE_KEY_PREFIX = 'zeron.auth.';
const PENDING_KEY_PREFIX = 'zeron.auth.pending.';
const log = createLog();

/** expo-secure-store only accepts `/^[\w.-]+$/` — `:` and `/` in a URL
 * base would throw and the Keychain write would never land. */
export const SECURE_STORE_KEY_RE = /^[\w.-]+$/;

export const sanitizeStoreKeyPart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, '_');

export const authStoreKey = (baseUrl: string): string =>
  `${STORE_KEY_PREFIX}${sanitizeStoreKeyPart(baseUrl)}`;

export const authPendingStoreKey = (baseUrl: string): string =>
  `${PENDING_KEY_PREFIX}${sanitizeStoreKeyPart(baseUrl)}`;

interface PersistedAuth {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  orgId?: string;
}

interface PendingSignIn {
  state: string;
  codeVerifier?: string;
  expiresAt: number;
}

const randomState = (): string =>
  `${MOBILE_SIGN_IN_STATE_PREFIX}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 18)}`;

export interface AuthSessionDeps {
  client: AuthClient;
  store: SecureStorePort;
  clock?: Clock;
  /** The edge base URL — namespaces the stored record. */
  baseUrl: string;
  /** clientId / redirectUri used to build authorize URLs. */
  clientId: string;
  workosApiBase?: string;
}

export class AuthSession implements TokenSource {
  private readonly client: AuthClient;
  private readonly store: SecureStorePort;
  private readonly clock: Clock;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly workosApiBase?: string;

  private authState: AuthState = { state: 'signedOut' };
  private persisted: PersistedAuth | undefined;
  private pendingSignIns = new Map<string, PendingSignIn>();
  private subscribers = new Set<(s: AuthState) => void>();
  private refreshInFlight: Promise<string | undefined> | undefined;
  private retryAttempts = 0;
  private retryTimer: unknown;
  private restored = false;

  constructor(deps: AuthSessionDeps) {
    this.client = deps.client;
    this.store = deps.store;
    this.clock = deps.clock ?? systemClock;
    this.baseUrl = deps.baseUrl;
    this.clientId = deps.clientId;
    this.workosApiBase = deps.workosApiBase;
  }

  private get storeKey(): string {
    return authStoreKey(this.baseUrl);
  }

  private get pendingStoreKey(): string {
    return authPendingStoreKey(this.baseUrl);
  }

  // ── restore / persistence ───────────────────────────────────────────────

  async restore(): Promise<void> {
    try {
      const raw = await this.store.get(this.storeKey);
      if (raw !== undefined) {
        try {
          const p = JSON.parse(raw) as PersistedAuth;
          if (typeof p.refreshToken === 'string') {
            this.persisted = p;
            this.setState(
              typeof p.orgId === 'string'
                ? { state: 'signedIn', user: p.user, orgId: p.orgId }
                : { state: 'needsOrganization', user: p.user },
            );
          }
        } catch {
          // corrupt record → signed out
        }
      }
      await this.restorePending();
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`auth restore failed (${name})`);
    }
    this.restored = true;
  }

  private async restorePending(): Promise<void> {
    const raw = await this.store.get(this.pendingStoreKey);
    if (raw === undefined) return;
    try {
      const list = JSON.parse(raw) as PendingSignIn[];
      if (!Array.isArray(list)) return;
      const now = this.clock.now();
      for (const p of list) {
        if (
          typeof p.state === 'string' &&
          typeof p.expiresAt === 'number' &&
          p.expiresAt >= now &&
          (p.codeVerifier === undefined || typeof p.codeVerifier === 'string')
        ) {
          this.pendingSignIns.set(p.state, p);
        }
      }
    } catch {
      // corrupt pending → ignore
    }
  }

  private async persist(): Promise<void> {
    try {
      if (this.persisted === undefined) await this.store.delete(this.storeKey);
      else await this.store.set(this.storeKey, JSON.stringify(this.persisted));
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`auth persist failed (${name})`);
    }
  }

  private async persistPending(): Promise<void> {
    const now = this.clock.now();
    const live = [...this.pendingSignIns.values()].filter(
      p => p.expiresAt >= now,
    );
    try {
      if (live.length === 0) await this.store.delete(this.pendingStoreKey);
      else await this.store.set(this.pendingStoreKey, JSON.stringify(live));
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      log.warn(`auth pending persist failed (${name})`);
    }
  }

  private setState(s: AuthState): void {
    this.authState = s;
    for (const cb of this.subscribers) cb(s);
  }

  subscribe(cb: (s: AuthState) => void): () => void {
    this.subscribers.add(cb);
    cb(this.authState);
    return () => this.subscribers.delete(cb);
  }

  get state(): AuthState {
    return this.authState;
  }

  // ── sign in ─────────────────────────────────────────────────────────────

  async beginSignIn(opts: {
    redirectUri: string;
    pkce: boolean;
    random?: (n: number) => Uint8Array;
    sha256?: (bytes: Uint8Array) => Promise<Uint8Array>;
  }): Promise<{ url: string; state: string }> {
    const state = randomState();
    const pending: PendingSignIn = {
      state,
      expiresAt: this.clock.now() + SIGN_IN_TTL_MS,
    };
    const params: AuthorizeParams = {
      workosApiBase: this.workosApiBase,
      clientId: this.clientId,
      redirectUri: opts.redirectUri,
      state,
    };
    if (opts.pkce) {
      const verifier = generateVerifier(
        opts.random ?? (n => crypto.getRandomValues(new Uint8Array(n))),
      );
      pending.codeVerifier = verifier;
      const sha =
        opts.sha256 ??
        (async b =>
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', b as BufferSource),
          ));
      params.codeChallenge = await challengeFor(verifier, sha);
    }
    this.pendingSignIns.set(state, pending);
    await this.persistPending();
    return { url: buildAuthorizeUrl(params), state };
  }

  private consumePending(state: string): PendingSignIn {
    const pending = this.pendingSignIns.get(state);
    this.pendingSignIns.delete(state);
    if (pending === undefined || pending.expiresAt < this.clock.now()) {
      throw new AuthRequestError({ kind: 'invalidResponse' });
    }
    return pending;
  }

  async completeSignIn(opts: {
    code: string;
    state: string;
  }): Promise<AuthState> {
    const pending = this.consumePending(opts.state);
    try {
      const { user, tokens } = await this.client.exchange(opts.code, {
        codeVerifier: pending.codeVerifier,
      });
      return await this.adoptTokens(user, tokens);
    } finally {
      await this.persistPending();
    }
  }

  async completePastedCode(text: string): Promise<AuthState> {
    const parsed = parsePastedCode(text);
    if (parsed === undefined)
      throw new AuthRequestError({ kind: 'invalidResponse' });
    return this.completeSignIn(parsed);
  }

  /** After exchange/refresh: org_id claim ⇒ signedIn, else needsOrganization. */
  private async adoptTokens(
    user: AuthUser,
    tokens: AuthTokens,
  ): Promise<AuthState> {
    this.persisted = {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      orgId: decodeJwtPayload(tokens.accessToken)?.org_id,
    };
    await this.persist();
    const next: AuthState =
      this.persisted.orgId !== undefined
        ? { state: 'signedIn', user, orgId: this.persisted.orgId }
        : { state: 'needsOrganization', user };
    this.setState(next);
    return next;
  }

  // ── orgs ────────────────────────────────────────────────────────────────

  private async accessTokenNow(): Promise<string> {
    const token = this.persisted?.accessToken;
    if (token === undefined)
      throw new AuthRequestError({ kind: 'invalidResponse' });
    return token;
  }

  async listOrgs() {
    return this.client.orgs(await this.accessTokenNow());
  }

  async createOrg(name: string): Promise<string> {
    return this.client.createOrg(await this.accessTokenNow(), name);
  }

  /** Org-scoped refresh; state follows the returned token's org_id. */
  async selectOrg(orgId: string): Promise<AuthState> {
    if (this.persisted === undefined)
      throw new AuthRequestError({ kind: 'invalidResponse' });
    const tokens = await this.client.refresh(
      this.persisted.refreshToken,
      orgId,
    );
    return this.adoptTokens(this.persisted.user, tokens);
  }

  // ── TokenSource ─────────────────────────────────────────────────────────

  async currentToken(): Promise<string | undefined> {
    if (!this.restored) await this.restore();
    const p = this.persisted;
    if (p === undefined) return undefined;
    const exp = decodeJwtPayload(p.accessToken)?.exp;
    if (exp !== undefined && exp * 1000 - TOKEN_SLACK_MS > this.clock.now()) {
      return p.accessToken;
    }
    return this.refreshShared();
  }

  /** edgeFetch calls this on a 401 — force one refresh (single-flight). */
  onAuthFailure(): void {
    this.refreshShared(true).catch(() => {});
  }

  private refreshShared(force = false): Promise<string | undefined> {
    if (!force && this.refreshInFlight !== undefined)
      return this.refreshInFlight;
    if (force && this.refreshInFlight !== undefined)
      return this.refreshInFlight;
    const p = this.persisted;
    if (p === undefined) return Promise.resolve(undefined);
    this.refreshInFlight = this.doRefresh(p).finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(p: PersistedAuth): Promise<string | undefined> {
    try {
      const tokens = await this.client.refresh(p.refreshToken, p.orgId);
      await this.adoptTokens(p.user, tokens);
      this.retryAttempts = 0;
      return tokens.accessToken;
    } catch (error) {
      if (
        error instanceof AuthRequestError &&
        error.detail.kind === 'http' &&
        error.detail.status === 401
      ) {
        // refresh revoked → signed out, storage cleared
        this.persisted = undefined;
        await this.persist();
        this.setState({ state: 'signedOut' });
        return undefined;
      }
      // network/5xx → keep state, schedule retry, callers get undefined
      this.scheduleRetry();
      return undefined;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined) return;
    const delay = Math.min(
      REFRESH_RETRY_BASE_MS * 2 ** this.retryAttempts,
      REFRESH_RETRY_MAX_MS,
    );
    this.retryAttempts += 1;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      if (this.persisted !== undefined)
        this.refreshShared(true).catch(() => {});
    }, delay);
  }

  async signOut(): Promise<void> {
    if (this.retryTimer !== undefined) {
      this.clock.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.persisted = undefined;
    this.pendingSignIns.clear();
    await this.persist();
    await this.persistPending();
    this.setState({ state: 'signedOut' });
  }
}

/** Dev mode (AUTH_MODE=dev edge): always signed in; the bearer string IS
 * `user@org` — the edge mints fake claims from it. */
export class DevAuthSession implements TokenSource {
  readonly state: AuthState;

  constructor(
    userId: string,
    orgId: string,
    private readonly token = `${userId}@${orgId}`,
  ) {
    this.state = { state: 'signedIn', user: { id: userId }, orgId };
  }

  async currentToken(): Promise<string | undefined> {
    return this.token;
  }

  onAuthFailure(): void {
    // dev tokens never expire
  }

  subscribe(cb: (s: AuthState) => void): () => void {
    cb(this.state);
    return () => {};
  }

  async signOut(): Promise<void> {}
}
