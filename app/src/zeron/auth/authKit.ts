// Ported from zeron@853872d crates/engine/src/auth.rs (begin_sign_in URL
// shape L624–642, pending-state CSRF check) — AuthKit/PKCE helpers.

/** Percent-encode like the engine's url_encode (application/x-www-form-
 *-urlencoded semantics for query values). */
const urlEncode = (s: string): string => encodeURIComponent(s);

export interface AuthorizeParams {
  /** WorkOS API base (the engine's workos_api_base, default below). */
  workosApiBase?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  /** RFC 7636 S256 challenge — present only when PKCE is on. */
  codeChallenge?: string;
}

/** The engine's authorize URL (crates/engine/src/auth.rs begin_sign_in):
 * `{base}/user_management/authorize?response_type=code&client_id=…&
 * redirect_uri=…&provider=authkit&state=…` plus
 * `&code_challenge=…&code_challenge_method=S256` when PKCE is on. */
export const buildAuthorizeUrl = (params: AuthorizeParams): string => {
  const base = (params.workosApiBase ?? 'https://api.workos.com').replace(
    /\/+$/,
    '',
  );
  let url =
    `${base}/user_management/authorize?response_type=code` +
    `&client_id=${urlEncode(params.clientId)}` +
    `&redirect_uri=${urlEncode(params.redirectUri)}` +
    `&provider=authkit&state=${urlEncode(params.state)}`;
  if (params.codeChallenge !== undefined) {
    url += `&code_challenge=${urlEncode(
      params.codeChallenge,
    )}&code_challenge_method=S256`;
  }
  return url;
};

export interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
}

/** Parse a redirect callback URL (query params code/state/error). */
export const parseCallbackUrl = (url: string): CallbackResult => {
  const mark = url.indexOf('?');
  const frag = url.indexOf('#');
  const out: CallbackResult = {};
  for (const span of [
    mark >= 0 ? url.slice(mark + 1, frag >= 0 ? frag : undefined) : '',
    frag >= 0 ? url.slice(frag + 1) : '',
  ]) {
    for (const pair of span.split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = decodeURIComponent(pair.slice(0, eq));
      const value = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      if (key === 'code') out.code = value;
      else if (key === 'state') out.state = value;
      else if (key === 'error') out.error = value;
    }
  }
  return out;
};

/** Parse a pasted `state.code` (the edge's cli/callback page shows one) —
 * split on the FIRST '.', both halves non-empty. */
export const parsePastedCode = (
  text: string,
): { state: string; code: string } | undefined => {
  const trimmed = text.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return undefined;
  return { state: trimmed.slice(0, dot), code: trimmed.slice(dot + 1) };
};

// ── PKCE (RFC 7636) — crypto injected (Node tests use `crypto`; the app
// injects expo-crypto). ────────────────────────────────────────────────────

const base64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
};

const VERIFIER_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** 64-char verifier from the unreserved alphabet (RFC 7636 §4.1). */
export const generateVerifier = (random: (n: number) => Uint8Array): string => {
  const bytes = random(64);
  let out = '';
  for (const b of bytes) out += VERIFIER_ALPHABET[b % VERIFIER_ALPHABET.length];
  return out;
};

/** BASE64URL(SHA256(verifier)) — the S256 challenge. */
export const challengeFor = async (
  verifier: string,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<string> =>
  base64url(await sha256(new TextEncoder().encode(verifier)));

// ── JWT payload (display/expiry only — the edge verifies signatures) ───────

export interface JwtPayload {
  sub?: string;
  org_id?: string;
  exp?: number;
  [k: string]: unknown;
}

export const decodeJwtPayload = (token: string): JwtPayload | undefined => {
  const segments = token.split('.');
  if (segments.length !== 3) return undefined;
  try {
    let b64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bin =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('binary');
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    return typeof obj === 'object' && obj !== null
      ? (obj as JwtPayload)
      : undefined;
  } catch {
    return undefined;
  }
};
