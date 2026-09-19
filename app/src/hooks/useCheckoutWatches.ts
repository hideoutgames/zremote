// Subscribe to WatchCheckoutChangeRequest + WatchCheckoutDiffs for the
// session's checkout so the composer PR pill can render. Overview list
// PR dots share the change-request stream via retainChangeRequestWatch.

import { useEffect } from 'react';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import { METHODS } from '../zeron/protocol/rpc';
import type { Chat, CheckoutDiff } from '../zeron/protocol/types';
import { retainChangeRequestWatch } from '../zeron/state/changeRequestWatches';
import { setCheckoutDiffForChat } from '../zeron/state/changeRequestStore';
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
      return;
    }
    const releaseCr = retainChangeRequestWatch(
      runtime,
      chatId,
      deviceId,
      cwd,
      branch,
    );
    const relay = runtime.relayFor(deviceId);
    if (relay.stream === undefined) {
      return () => {
        releaseCr();
      };
    }
    let cancelled = false;
    let diffStream: { cancel(): void } | undefined;

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
      diffStream?.cancel();
      setCheckoutDiffForChat(chatId, undefined);
      releaseCr();
    };
  }, [runtime, chatId, deviceId, cwd, branch, checkoutId]);
};

/** Fan out unique checkout CR watches for visible overview chats. */
export const useOverviewChangeRequestWatches = (
  runtime: AppRuntime | null,
  chats: readonly Pick<Chat, 'id' | 'deviceId' | 'cwd' | 'branch'>[],
): void => {
  const key = chats
    .map(c => `${c.id}\0${c.deviceId}\0${c.cwd ?? ''}\0${c.branch ?? ''}`)
    .join('|');
  useEffect(() => {
    if (runtime === null || key === '') return;
    const releases: (() => void)[] = [];
    for (const entry of key.split('|')) {
      const [id, deviceId, cwd, branch] = entry.split('\0');
      if (
        id === undefined ||
        deviceId === undefined ||
        cwd === undefined ||
        cwd === '' ||
        branch === undefined ||
        branch === ''
      )
        continue;
      releases.push(
        retainChangeRequestWatch(runtime, id, deviceId, cwd, branch),
      );
    }
    return () => {
      for (const release of releases) release();
    };
  }, [runtime, key]);
};
