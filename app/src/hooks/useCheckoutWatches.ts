// Subscribe to WatchCheckoutChangeRequest + WatchCheckoutDiffs for the
// session's checkout so the composer PR pill can render.

import { useEffect } from 'react';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import { METHODS } from '../zeron/protocol/rpc';
import type {
  CheckoutChangeRequestStatus,
  CheckoutDiff,
} from '../zeron/protocol/types';
import {
  clearChangeRequestForChat,
  setChangeRequestForChat,
  setCheckoutDiffForChat,
} from '../zeron/state/changeRequestStore';
import { diffForCheckout } from '../zeron/diff/diffState';

export const useCheckoutWatches = (
  runtime: AppRuntime | null,
  chatId: string,
  deviceId: string | undefined,
  cwd: string | undefined,
  branch: string | undefined,
  checkoutId: string | undefined,
): void => {
  useEffect(() => {
    if (
      runtime === null ||
      deviceId === undefined ||
      cwd === undefined ||
      cwd === '' ||
      branch === undefined ||
      branch.trim() === ''
    ) {
      clearChangeRequestForChat(chatId);
      return;
    }
    const relay = runtime.relayFor(deviceId);
    if (relay.stream === undefined) return;
    let cancelled = false;
    let crStream: { cancel(): void } | undefined;
    let diffStream: { cancel(): void } | undefined;

    relay
      .stream<CheckoutChangeRequestStatus>(
        METHODS.WATCH_CHECKOUT_CHANGE_REQUEST,
        { cwd, branch },
      )
      .then(async s => {
        crStream = s;
        for await (const status of s.items) {
          if (cancelled) break;
          setChangeRequestForChat(chatId, status);
        }
      })
      .catch(() => {
        if (!cancelled) setChangeRequestForChat(chatId, undefined);
      });

    relay
      .stream<CheckoutDiff[]>(METHODS.WATCH_CHECKOUT_DIFFS, {})
      .then(async s => {
        diffStream = s;
        for await (const diffs of s.items) {
          if (cancelled) break;
          const diff =
            checkoutId !== undefined
              ? diffForCheckout(diffs, checkoutId)
              : diffs.find(d => d.cwd === cwd);
          setCheckoutDiffForChat(chatId, diff);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckoutDiffForChat(chatId, undefined);
      });

    return () => {
      cancelled = true;
      crStream?.cancel();
      diffStream?.cancel();
      clearChangeRequestForChat(chatId);
    };
  }, [runtime, chatId, deviceId, cwd, branch, checkoutId]);
};
