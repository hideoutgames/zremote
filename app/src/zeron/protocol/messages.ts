// Ported from zeron@853872d edge/src/session-doc/messages.ts
// (joinContinuations), apps/ios/Zeron/Sync/SessionStore.swift
// (liveEntry, openInputRequest), apps/ios/Zeron/Composer/Attachments.swift
// (withAttachments, attachmentOnlyText) and apps/ios/Zeron/Sync/UploadStash.swift
// (pendingRef / pendingRefPrefix).

import type { MessageEntry, MessagePart, UserInputQuestion } from './types';

/**
 * Stitch continuation entries back onto their roots (render-time inverse of
 * the segment split cap); preserves list order otherwise. Orphan
 * continuations (root trimmed or not yet synced) surface as-is rather than
 * dropping content.
 */
export const joinContinuations = <
  E extends { id: string; parts: MessagePart[]; continuationOf?: string },
>(
  entries: readonly E[],
): E[] => {
  if (!entries.some(e => e.continuationOf)) return [...entries];
  const rootIndex = new Map<string, number>();
  const order: E[] = [];
  for (const entry of entries) {
    if (entry.continuationOf) {
      const at = rootIndex.get(entry.continuationOf);
      if (at !== undefined) {
        const root = order[at];
        order[at] = { ...root, parts: [...root.parts, ...entry.parts] };
        continue;
      }
      order.push(entry);
      continue;
    }
    rootIndex.set(entry.id, order.length);
    order.push(entry);
  }
  return order;
};

/** The last entry still marked `streaming` (SessionStore.liveEntry). */
export const liveEntry = (
  entries: readonly MessageEntry[],
): MessageEntry | undefined => {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === 'streaming') return entries[i];
  }
  return undefined;
};

export interface OpenInputRequest {
  entryId: string;
  requestId: string;
  questions: UserInputQuestion[];
}

/** The unresolved input request to surface (SessionStore.openInputRequest):
 * the LAST unresolved input part with a non-empty question list — an empty
 * list can't be answered and must not take the composer's place. */
export const openInputRequest = (
  entries: readonly MessageEntry[],
): OpenInputRequest | undefined => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    for (let j = entry.parts.length - 1; j >= 0; j--) {
      const part = entry.parts[j];
      if (
        part.kind === 'input' &&
        !part.resolved &&
        part.questions.length > 0
      ) {
        return {
          entryId: entry.id,
          requestId: part.requestId,
          questions: part.questions,
        };
      }
    }
  }
  return undefined;
};

// ── Attachment text transport (use-attachments.ts / Attachments.swift) ──────

/** The body used when the user sends files with an empty prompt. */
export const ATTACHMENT_ONLY_TEXT = 'See the attached file(s).';

export const ATTACHMENT_TRAILER_HEADER =
  'Attached files (local files — open them to view):';

/** `withAttachments`: plain local paths appended to the text — the files are
 * staged on the device that runs the agent. */
export const withAttachments = (
  text: string,
  paths: readonly string[],
): string => {
  if (paths.length === 0) return text;
  const body = text.length === 0 ? ATTACHMENT_ONLY_TEXT : text;
  const refs = paths.map(p => `- ${p}`).join('\n');
  return `${body}\n\n${ATTACHMENT_TRAILER_HEADER}\n${refs}`;
};

export const PENDING_REF_PREFIX = 'pending://';

/** `pending://{uploadId}/{name}` — the queued-attachment ref (UploadStash). */
export const pendingRef = (uploadId: string, name: string): string =>
  `${PENDING_REF_PREFIX}${uploadId}/${name}`;

/** Parse a `pending://{uploadId}/{name}` ref back into its parts. */
export const parsePendingRef = (
  ref: string,
): { uploadId: string; name: string } | undefined => {
  if (!ref.startsWith(PENDING_REF_PREFIX)) return undefined;
  const body = ref.slice(PENDING_REF_PREFIX.length);
  const slash = body.indexOf('/');
  if (slash <= 0 || slash === body.length - 1) return undefined;
  return { uploadId: body.slice(0, slash), name: body.slice(slash + 1) };
};
