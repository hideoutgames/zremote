// Label helpers for session chrome — derived strings only.

import type { ChatIndicator } from '../protocol/entities';
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

export type ThreadPrStatus = {
  tone: 'open' | 'merged' | 'draft';
  additions: number;
  deletions: number;
};

export type ThreadStatusLine =
  | { kind: 'working' }
  | { kind: 'awaitingInput' }
  | { kind: 'errored' }
  | {
      kind: 'pr';
      tone: ThreadPrStatus['tone'];
      additions: number;
      deletions: number;
    }
  | { kind: 'time'; label: string };

/** Home-list subtitle: live status, then PR, then relative time. */
export const threadStatusLine = (
  indicator: ChatIndicator,
  pr: ThreadPrStatus | undefined,
  timeLabel: string,
): ThreadStatusLine => {
  if (indicator === 'working') return { kind: 'working' };
  if (indicator === 'awaitingInput') return { kind: 'awaitingInput' };
  if (indicator === 'errored') return { kind: 'errored' };
  if (pr !== undefined)
    return {
      kind: 'pr',
      tone: pr.tone,
      additions: pr.additions,
      deletions: pr.deletions,
    };
  return { kind: 'time', label: timeLabel };
};
