// Pure policy for whether a finish-banner should appear while the app is
// already open. Hide only when the user is looking at that exact thread;
// Home (and any other session) still gets the banner.

import { EDGE_ID_RE } from '../zeron/protocol/edge';

export type PresentArgs = {
  appState: string;
  selectedChatId: string | undefined;
  notificationChatId: string | undefined;
};

export const shouldPresentBanner = (a: PresentArgs): boolean => {
  if (a.appState !== 'active') return true;
  if (a.notificationChatId === undefined || a.selectedChatId === undefined)
    return true;
  return a.selectedChatId !== a.notificationChatId;
};

/** Read `chatId` out of an APNs custom payload (top-level next to `aps`). */
export const chatIdFromData = (data: unknown): string | undefined => {
  if (data === null || typeof data !== 'object') return undefined;
  const rec = data as Record<string, unknown>;
  const id = rec.chatId;
  if (typeof id === 'string' && EDGE_ID_RE.test(id)) return id;
  return undefined;
};
