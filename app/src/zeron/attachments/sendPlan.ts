// Send plan for a draft carrying attachments — mirrors the composer's
// routing in ComposerView.swift (queue-first when the host has
// message-queue-attachments-v1, legacy upload-first otherwise, never a
// device-local URI in the wire payload).

import type { RunPhase } from '../state/sessionStores';

export type SendPlan =
  /** Row lands on the doc's `queue` list with `pending://` refs; an escort
   * pushes the bytes after it. */
  | 'queue'
  /** Upload each file first (progress rings), then sendRun with the
   * committed host paths. */
  | 'legacy'
  /** Live run without queue support — steering carries no attachments; the
   * composer must surface this, never silently drop. */
  | 'blocked'
  /** No attachments — the existing run/steer/queue paths apply. */
  | 'direct';

export const CAP_QUEUE = 'message-queue-v1';
export const CAP_QUEUE_ATTACHMENTS = 'message-queue-attachments-v1';
export const CAP_QUEUE_ACTIONS = 'message-queue-actions-v1';
export const CAP_QUEUE_EDIT_LEASE = 'message-queue-edit-lease-v1';

export const sendPlan = (
  phase: RunPhase,
  capabilities: ReadonlySet<string>,
  hasAttachments: boolean,
): SendPlan => {
  if (!hasAttachments) return 'direct';
  const queueReady =
    capabilities.has(CAP_QUEUE) && capabilities.has(CAP_QUEUE_ATTACHMENTS);
  if (queueReady) return 'queue';
  if (phase === 'working' || phase === 'awaitingInput' || phase === 'stopping')
    return 'blocked';
  return 'legacy';
};
