// liveActivityRegistry: PUT/DELETE shape, bearer auth, 401 retry.

import {
  registerLiveActivityToken,
  unregisterLiveActivityToken,
} from '../liveActivityRegistry';
import { staticTokenSource } from '../tokenSource';
import type { FetchImpl, FetchResponse } from '../edgeHttp';

const ok = (): FetchResponse => ({
  status: 200,
  headers: { get: () => null },
  arrayBuffer: async () => new ArrayBuffer(0),
  text: async () => '{}',
});

const reg = {
  chatId: 'chat-1',
  token: 'apns-token-abc',
  kind: 'activity' as const,
  device: 'phone-1',
};

test('PUT /registry/{org}/live-activity with bearer + payload', async () => {
  const calls: {
    url: string;
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Uint8Array;
    };
  }[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, init });
    return ok();
  };
  await registerLiveActivityToken(
    'https://edge.test/',
    staticTokenSource('tok'),
    'org-1',
    reg,
    fetchImpl,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://edge.test/registry/org-1/live-activity');
  expect(calls[0].init.method).toBe('PUT');
  expect(calls[0].init.headers?.Authorization).toBe('Bearer tok');
  expect(JSON.parse(String(calls[0].init.body ?? '{}'))).toEqual(reg);
});

test('DELETE sends the same payload', async () => {
  const calls: { method?: string; body?: string | Uint8Array }[] = [];
  const fetchImpl: FetchImpl = async (_url, init) => {
    calls.push(init);
    return ok();
  };
  await unregisterLiveActivityToken(
    'https://edge.test',
    staticTokenSource('tok'),
    'org-1',
    { ...reg, kind: 'push_to_start' },
    fetchImpl,
  );
  expect(calls[0].method).toBe('DELETE');
  expect(JSON.parse(String(calls[0].body ?? '{}')).kind).toBe('push_to_start');
});

test('401 → refresh once → retry; second 401 throws', async () => {
  let auths = 0;
  const fetchImpl: FetchImpl = async () => ({
    ...ok(),
    status: 401,
  });
  const source = {
    currentToken: async () => `tok${++auths}`,
    onAuthFailure: () => {},
  };
  await expect(
    registerLiveActivityToken(
      'https://edge.test',
      source,
      'org-1',
      reg,
      fetchImpl,
    ),
  ).rejects.toThrow('401');
  expect(auths).toBe(2);
});
