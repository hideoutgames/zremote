// pushTokenRegistry: PUT/DELETE kind=alert on the live-activity route.

import {
  registerAlertPushToken,
  unregisterAlertPushToken,
} from '../pushTokenRegistry';
import { staticTokenSource } from '../tokenSource';
import type { FetchImpl, FetchResponse } from '../edgeHttp';

const ok = (): FetchResponse => ({
  status: 200,
  headers: { get: () => null },
  arrayBuffer: async () => new ArrayBuffer(0),
  text: async () => '{}',
});

const reg = {
  chatId: '*' as const,
  token: 'apns-device-token',
  kind: 'alert' as const,
  device: 'phone-1',
};

test('PUT /registry/{org}/live-activity with kind=alert + bearer', async () => {
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
  await registerAlertPushToken(
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
  await unregisterAlertPushToken(
    'https://edge.test',
    staticTokenSource('tok'),
    'org-1',
    reg,
    fetchImpl,
  );
  expect(calls[0].method).toBe('DELETE');
  expect(JSON.parse(String(calls[0].body ?? '{}'))).toEqual(reg);
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
    registerAlertPushToken(
      'https://edge.test',
      source,
      'org-1',
      reg,
      fetchImpl,
    ),
  ).rejects.toThrow('401');
  expect(auths).toBe(2);
});
