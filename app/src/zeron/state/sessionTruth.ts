// Label helpers for session chrome — derived strings only.

import type { Chat, DeviceRow } from '../protocol/types';

export const sessionTitle = (chat: Chat | undefined): string =>
  chat?.title !== undefined && chat.title !== '' ? chat.title : 'New session';

export const hostLabel = (
  chat: Chat | undefined,
  devices: readonly DeviceRow[],
): string => {
  if (chat === undefined) return 'unknown host';
  return devices.find(d => d.id === chat.deviceId)?.name ?? 'unknown host';
};

export const checkoutLabel = (chat: Chat | undefined): string | undefined => {
  if (chat === undefined) return undefined;
  const cwd = chat.cwd;
  const leaf = cwd?.split(/[\\/]/).filter(Boolean).pop();
  if (chat.branch !== undefined && leaf !== undefined)
    return `${leaf} @ ${chat.branch}`;
  return chat.branch ?? leaf;
};
