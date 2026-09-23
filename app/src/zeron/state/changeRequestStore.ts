// Host-local change-request + checkout-diff snapshots for the composer PR
// pill. Never written back to a synced document (desktop change_requests.rs).

import { useMemo } from 'react';
import { createStore, useStore } from 'zustand';
import type {
  ChangeRequestSummary,
  CheckoutChangeRequestStatus,
  CheckoutDiff,
} from '../protocol/types';
import { sameDetectedPrs } from '../protocol/detectChangeRequest';
import {
  prBadgeModel,
  threadPrDot,
  type PrBadgeModel,
  type ThreadPrDot,
} from '../../components/prBadge';

export interface ChangeRequestState {
  byChat: Record<string, CheckoutChangeRequestStatus | undefined>;
  diffByChat: Record<string, CheckoutDiff | undefined>;
  /** Transcript-scanned PR links per chat (detectChangeRequest.ts) — the
   * fallback for providers the host's `gh` lookup can't resolve, and for
   * threads whose checkout watch never answered. Newest first. */
  detectedByChat: Record<string, ChangeRequestSummary[] | undefined>;
}

export const changeRequestStore = createStore<ChangeRequestState>(() => ({
  byChat: {},
  diffByChat: {},
  detectedByChat: {},
}));

export const setChangeRequestForChat = (
  chatId: string,
  status: CheckoutChangeRequestStatus | undefined,
): void => {
  changeRequestStore.setState(s => ({
    byChat: { ...s.byChat, [chatId]: status },
  }));
};

export const setDetectedChangeRequestsForChat = (
  chatId: string,
  prs: ChangeRequestSummary[] | undefined,
): void => {
  const s = changeRequestStore.getState();
  const next = prs !== undefined && prs.length > 0 ? prs : undefined;
  if (sameDetectedPrs(s.detectedByChat[chatId], next)) return;
  changeRequestStore.setState(cur => ({
    detectedByChat: { ...cur.detectedByChat, [chatId]: next },
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

/** The thread's effective change request: the host-resolved checkout PR, or
 * the newest transcript-detected link when the host can't resolve one. */
export const effectiveChangeRequest = (
  s: ChangeRequestState,
  chatId: string,
): ChangeRequestSummary | undefined =>
  s.byChat[chatId]?.changeRequest ?? s.detectedByChat[chatId]?.[0];

export const badgeForChat = (
  chatId: string,
): {
  summary: ChangeRequestSummary | undefined;
  badge: PrBadgeModel | undefined;
} => {
  const s = changeRequestStore.getState();
  const summary = effectiveChangeRequest(s, chatId);
  const diff = s.diffByChat[chatId];
  return {
    summary,
    badge: summary === undefined ? undefined : prBadgeModel(summary, diff),
  };
};

export const usePrBadge = (chatId: string): PrBadgeModel | undefined => {
  const summary = useStore(changeRequestStore, s =>
    effectiveChangeRequest(s, chatId),
  );
  const diff = useStore(changeRequestStore, s => s.diffByChat[chatId]);
  return useMemo(
    () => (summary === undefined ? undefined : prBadgeModel(summary, diff)),
    [summary, diff],
  );
};

export const useThreadPrDot = (chatId: string): ThreadPrDot | null =>
  useStore(changeRequestStore, s =>
    threadPrDot(effectiveChangeRequest(s, chatId)),
  );
