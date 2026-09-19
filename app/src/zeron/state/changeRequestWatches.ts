// Refcounted WatchCheckoutChangeRequest streams, shared by the session
// composer pill and the overview thread-list PR dots. Keyed by
// (deviceId, cwd, branch) so chats that share a checkout share one stream.

import type { AppRuntime } from '../runtime/appRuntime';
import { METHODS } from '../protocol/rpc';
import type { CheckoutChangeRequestStatus } from '../protocol/types';
import {
  clearChangeRequestForChat,
  setChangeRequestForChat,
} from './changeRequestStore';

const checkoutKey = (deviceId: string, cwd: string, branch: string): string =>
  `${deviceId}\0${cwd}\0${branch}`;

interface Watch {
  refs: number;
  chatRefs: Map<string, number>;
  last: CheckoutChangeRequestStatus | undefined;
  hasLast: boolean;
  cancel: (() => void) | undefined;
}

const watches = new Map<string, Watch>();

const applyStatus = (
  key: string,
  status: CheckoutChangeRequestStatus | undefined,
): void => {
  const w = watches.get(key);
  if (w === undefined) return;
  w.last = status;
  w.hasLast = true;
  for (const id of w.chatRefs.keys()) setChangeRequestForChat(id, status);
};

const startStream = (
  runtime: AppRuntime,
  deviceId: string,
  cwd: string,
  branch: string,
  key: string,
): void => {
  const relay = runtime.relayFor(deviceId);
  if (relay.stream === undefined) return;
  let cancelled = false;
  let crStream: { cancel(): void } | undefined;
  relay
    .stream<CheckoutChangeRequestStatus>(
      METHODS.WATCH_CHECKOUT_CHANGE_REQUEST,
      { cwd, branch },
    )
    .then(async s => {
      crStream = s;
      for await (const status of s.items) {
        if (cancelled) break;
        applyStatus(key, status);
      }
    })
    .catch(() => {
      if (!cancelled) applyStatus(key, undefined);
    });
  const w = watches.get(key);
  if (w !== undefined)
    w.cancel = () => {
      cancelled = true;
      crStream?.cancel();
    };
};

export const retainChangeRequestWatch = (
  runtime: AppRuntime,
  chatId: string,
  deviceId: string,
  cwd: string,
  branch: string,
): (() => void) => {
  const key = checkoutKey(deviceId, cwd, branch);
  let w = watches.get(key);
  if (w === undefined) {
    w = {
      refs: 0,
      chatRefs: new Map(),
      last: undefined,
      hasLast: false,
      cancel: undefined,
    };
    watches.set(key, w);
    startStream(runtime, deviceId, cwd, branch, key);
  }
  w.refs += 1;
  const prev = w.chatRefs.get(chatId) ?? 0;
  w.chatRefs.set(chatId, prev + 1);
  if (prev === 0 && w.hasLast) setChangeRequestForChat(chatId, w.last);
  return () => {
    const cur = watches.get(key);
    if (cur === undefined) return;
    const n = (cur.chatRefs.get(chatId) ?? 1) - 1;
    if (n <= 0) {
      cur.chatRefs.delete(chatId);
      clearChangeRequestForChat(chatId);
    } else cur.chatRefs.set(chatId, n);
    cur.refs -= 1;
    if (cur.refs <= 0) {
      cur.cancel?.();
      watches.delete(key);
    }
  };
};
