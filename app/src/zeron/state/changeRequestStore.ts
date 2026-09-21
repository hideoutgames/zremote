// Host-local change-request + checkout-diff snapshots for the composer PR
// pill. Never written back to a synced document (desktop change_requests.rs).

import { useMemo } from 'react';
import { createStore, useStore } from 'zustand';
import type {
  ChangeRequestSummary,
  CheckoutChangeRequestStatus,
  CheckoutDiff,
} from '../protocol/types';
import {
  prBadgeModel,
  threadPrDot,
  type PrBadgeModel,
  type ThreadPrDot,
} from '../../components/prBadge';

export interface ChangeRequestState {
  byChat: Record<string, CheckoutChangeRequestStatus | undefined>;
  diffByChat: Record<string, CheckoutDiff | undefined>;
}

export const changeRequestStore = createStore<ChangeRequestState>(() => ({
  byChat: {},
  diffByChat: {},
}));

export const setChangeRequestForChat = (
  chatId: string,
  status: CheckoutChangeRequestStatus | undefined,
): void => {
  changeRequestStore.setState(s => ({
    byChat: { ...s.byChat, [chatId]: status },
  }));
};

export const setCheckoutDiffForChat = (
  chatId: string,
  diff: CheckoutDiff | undefined,
): void => {
  changeRequestStore.setState(s => ({
    diffByChat: { ...s.diffByChat, [chatId]: diff },
  }));
};

export const clearChangeRequestForChat = (chatId: string): void => {
  changeRequestStore.setState(s => {
    const byChat = { ...s.byChat };
    const diffByChat = { ...s.diffByChat };
    delete byChat[chatId];
    delete diffByChat[chatId];
    return { byChat, diffByChat };
  });
};

export const badgeForChat = (
  chatId: string,
): {
  summary: ChangeRequestSummary | undefined;
  badge: PrBadgeModel | undefined;
} => {
  const s = changeRequestStore.getState();
  const summary = s.byChat[chatId]?.changeRequest ?? undefined;
  const diff = s.diffByChat[chatId];
  return {
    summary,
    badge: summary === undefined ? undefined : prBadgeModel(summary, diff),
  };
};

export const usePrBadge = (chatId: string): PrBadgeModel | undefined => {
  const summary = useStore(
    changeRequestStore,
    s => s.byChat[chatId]?.changeRequest ?? undefined,
  );
  const diff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  return useMemo(
    () => (summary === undefined ? undefined : prBadgeModel(summary, diff)),
    [summary, diff],
  );
};

export const useThreadPrDot = (chatId: string): ThreadPrDot | null =>
  useStore(changeRequestStore, s =>
    threadPrDot(s.byChat[chatId]?.changeRequest ?? undefined),
  );
