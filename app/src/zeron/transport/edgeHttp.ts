// Ported from zeron@853872d — edge HTTPS plumbing shared by the transport
// fallbacks (AppConfig.swift request builders; the 401 → refresh → retry
// once shape from AuthSession/TokenSource semantics).

import type { TokenSource } from './tokenSource';

export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
};

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type FetchImpl = (
  url: string,
  init: FetchInit,
) => Promise<FetchResponse>;

/** Non-2xx answers. */
export class EdgeHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`edge http ${status}: ${body.slice(0, 200)}`);
    this.name = 'EdgeHttpError';
  }
}

const globalFetch: FetchImpl = async (url, init) => {
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

/**
 * Fetch with bearer attached. On 401: fire `onAuthFailure` once (the token
 * source rotates/refreshes), then retry ONCE with a fresh token — repeated
 * 401s surface as EdgeHttpError, never a retry loop.
 */
export const edgeFetch = async (
  url: string,
  tokenSource: TokenSource,
  init: FetchInit = {},
  fetchImpl: FetchImpl = globalFetch,
): Promise<FetchResponse> => {
  const send = async (): Promise<FetchResponse> => {
    const token = await tokenSource.currentToken();
    const headers = { ...init.headers };
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    return fetchImpl(url, { ...init, headers });
  };
  const res = await send();
  if (res.status !== 401) return res;
  tokenSource.onAuthFailure?.();
  return send();
};

/** edgeFetch + 2xx enforcement + JSON body. */
export const edgeFetchJson = async <T>(
  url: string,
  tokenSource: TokenSource,
  init: FetchInit = {},
  fetchImpl: FetchImpl = globalFetch,
): Promise<T> => {
  const res = await edgeFetch(url, tokenSource, init, fetchImpl);
  const text = await res.text();
  if (res.status < 200 || res.status >= 300)
    throw new EdgeHttpError(res.status, text);
  return JSON.parse(text) as T;
};

/** edgeFetch + 2xx enforcement + raw bytes (checkpoint blobs). */
export const edgeFetchBytes = async (
  url: string,
  tokenSource: TokenSource,
  init: FetchInit = {},
  fetchImpl: FetchImpl = globalFetch,
): Promise<{ bytes: Uint8Array; res: FetchResponse }> => {
  const res = await edgeFetch(url, tokenSource, init, fetchImpl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (res.status < 200 || res.status >= 300) {
    throw new EdgeHttpError(res.status, new TextDecoder().decode(bytes));
  }
  return { bytes, res };
};
