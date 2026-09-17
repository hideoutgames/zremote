// Live Activity push token registry — PUT/DELETE on the edge's
// `/registry/{org}/live-activity` (the zremote-edge-patches endpoint in
// docs/HOST_EDGE_CHANGES.md). Tokens bind {orgId,userId,chatId,phoneDeviceId};
// `kind` distinguishes per-activity tokens from push-to-start tokens.

import { edgeFetchJson } from './edgeHttp';
import type { FetchImpl } from './edgeHttp';
import type { TokenSource } from './tokenSource';

export type LiveActivityTokenKind = 'activity' | 'push_to_start';

export type LiveActivityRegistration = {
  chatId: string;
  token: string;
  kind: LiveActivityTokenKind;
  device: string;
};

const route = (edgeUrl: string, orgId: string): string =>
  `${edgeUrl.replace(/\/$/, '')}/registry/${encodeURIComponent(
    orgId,
  )}/live-activity`;

export const registerLiveActivityToken = async (
  edgeUrl: string,
  tokenSource: TokenSource,
  orgId: string,
  reg: LiveActivityRegistration,
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

export const unregisterLiveActivityToken = async (
  edgeUrl: string,
  tokenSource: TokenSource,
  orgId: string,
  reg: LiveActivityRegistration,
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
