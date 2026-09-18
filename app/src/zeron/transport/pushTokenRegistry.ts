// Alert-push token registry — PUT/DELETE `{kind:'alert'}` on the edge's
// `/registry/{org}/live-activity` (docs/HOST_EDGE_CHANGES.md §4). The token
// is the native APNs device token (not an ActivityKit token); chatId is
// always `*` because finish banners are device-scoped.

import { edgeFetchJson } from './edgeHttp';
import type { FetchImpl } from './edgeHttp';
import type { TokenSource } from './tokenSource';

export type AlertPushRegistration = {
  chatId: '*';
  token: string;
  kind: 'alert';
  device: string;
};

const route = (edgeUrl: string, orgId: string): string =>
  `${edgeUrl.replace(/\/$/, '')}/registry/${encodeURIComponent(
    orgId,
  )}/live-activity`;

export const registerAlertPushToken = async (
  edgeUrl: string,
  tokenSource: TokenSource,
  orgId: string,
  reg: AlertPushRegistration,
  fetchImpl?: FetchImpl,
): Promise<void> => {
  await edgeFetchJson(
    route(edgeUrl, orgId),
    tokenSource,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reg),
    },
    fetchImpl,
  );
};

export const unregisterAlertPushToken = async (
  edgeUrl: string,
  tokenSource: TokenSource,
  orgId: string,
  reg: AlertPushRegistration,
  fetchImpl?: FetchImpl,
): Promise<void> => {
  await edgeFetchJson(
    route(edgeUrl, orgId),
    tokenSource,
    {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reg),
    },
    fetchImpl,
  );
};
