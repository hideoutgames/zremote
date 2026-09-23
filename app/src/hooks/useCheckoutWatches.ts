// Subscribe to WatchCheckoutChangeRequest + WatchCheckoutDiffs for the
// session's checkout so the composer PR pill can render, and run the
// transcript PR detector so non-GitHub threads still surface their request.
// Overview list PR dots share the change-request stream via
// retainChangeRequestWatch.

import { useEffect } from 'react';
import type { AppRuntime } from '../zeron/runtime/appRuntime';
import { METHODS } from '../zeron/protocol/rpc';
import type { Chat, CheckoutDiff } from '../zeron/protocol/types';
import { retainChangeRequestWatch } from '../zeron/state/changeRequestWatches';
import {
  setCheckoutDiffForChat,
  setDetectedChangeRequestsForChat,
} from '../zeron/state/changeRequestStore';
import { diffForCheckout } from '../zeron/diff/diffState';
import {
  clearThreadPrScanner,
  scanThreadPrs,
} from '../zeron/protocol/detectChangeRequest';
import { getSessionStore } from '../zeron/state/sessionStores';

/**
 * The checkout identity a chat's PR watch should target. The host-stamped
 * `sourceContext` wins: its repoRoot/branch were captured at dispatch and a
 * chat sharing the checkout can never overwrite them (upstream
 * `desired_watch_targets`). Legacy scalar fields are the fallback for hosts
 * that predate the stamp — equal to the old behaviour.
 */
export const chatCheckoutTarget = (
  chat: Pick<Chat, 'cwd' | 'branch' | 'checkoutId' | 'sourceContext'>,
  spacePath?: string,
): { cwd: string; branch: string; checkoutId: string | undefined } | null => {
  const src = chat.sourceContext;
  if (src !== undefined) {
    if (src.branch.trim() === '') return null;
    return {
      cwd: src.repoRoot,
      branch: src.branch,
      checkoutId: src.checkoutId === '' ? undefined : src.checkoutId,
    };
  }
  const cwd = chat.cwd ?? spacePath;
  const branch = chat.branch;
  if (
    cwd === undefined ||
    cwd === '' ||
    branch === undefined ||
    branch.trim() === ''
  ) {
    return null;
  }
  return { cwd, branch, checkoutId: chat.checkoutId };
};

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

/** Scan the thread's transcript for PR/MR links the host can't resolve —
 * every git provider's URL shape, not just GitHub. Host results always win
 * when both exist; detected rows persist after unmount so list dots survive
 * navigation. */
export const useDetectedChangeRequests = (chatId: string): void => {
  useEffect(() => {
    const store = getSessionStore(chatId);
    const scan = (): void => {
      setDetectedChangeRequestsForChat(
        chatId,
        scanThreadPrs(chatId, store.getState().entries),
      );
    };
    scan();
    const unsub = store.subscribe(scan);
    return () => {
      unsub();
      clearThreadPrScanner(chatId);
    };
  }, [chatId]);
};

/** Fan out unique checkout CR watches for visible overview chats. */
export const useOverviewChangeRequestWatches = (
  runtime: AppRuntime | null,
  chats: readonly Pick<
    Chat,
    'id' | 'deviceId' | 'cwd' | 'branch' | 'checkoutId' | 'sourceContext'
  >[],
): void => {
  const key = chats
    .map(c => {
      const target = chatCheckoutTarget(c);
      return `${c.id}\0${c.deviceId}\0${target?.cwd ?? ''}\0${
        target?.branch ?? ''
      }`;
    })
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
