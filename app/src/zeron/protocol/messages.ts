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

/** Host queue drain (`queued_message_prompt`) uses this body for an empty row. */
export const HOST_ATTACHMENT_ONLY_TEXT = 'See the attached image(s).';

/** Host queue drain header. The phone's own trailer says "files". */
export const HOST_ATTACHMENT_TRAILER_HEADER =
  'Attached images (local files — open them to view):';

export const PENDING_REF_PREFIX = 'pending://';

/** `pending://{uploadId}/{name}` — bytes staged locally, not a host path.
 * Queue rows must not carry these: the host copies `attachments` into the
 * visible prompt verbatim and does not rewrite them. */
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

export interface UserMessageAttachment {
  path: string;
  name: string;
}

export interface ParsedUserMessage {
  /** Prompt with the attachment trailer removed. Empty for file-only sends. */
  text: string;
  attachments: UserMessageAttachment[];
}

const ATTACHMENT_ONLY_BODIES = new Set([
  ATTACHMENT_ONLY_TEXT,
  HOST_ATTACHMENT_ONLY_TEXT,
]);

const isTrailerHeader = (line: string): boolean => {
  const header = line.trim().toLowerCase();
  return (
    (header.startsWith('attached images (local files') ||
      header.startsWith('attached files (local files')) &&
    header.endsWith('):')
  );
};

/** Last path segment, or the file name inside a `pending://` ref. */
export const attachmentName = (path: string): string => {
  const pending = parsePendingRef(path);
  const raw = pending?.name ?? path;
  const name = raw.split(/[/\\]/).pop()?.trim() ?? '';
  return name.length > 0 ? name : 'file';
};

/** Split a user prompt into visible text and attachment refs.
 * Mirrors `parse_user_message_images` (crates/ui/src/attachments.rs): a blank
 * line, then `Attached images|files (local files …):`, then `- path` lines.
 * `pending://` refs stay data — callers render the file name, never the URL. */
export const parseUserMessageAttachments = (
  content: string,
): ParsedUserMessage => {
  const lower = content.toLowerCase();
  const needles = [
    '\n\nattached images (local files',
    '\n\nattached files (local files',
  ];
  let from = 0;
  while (from < content.length) {
    const hits = needles
      .map(needle => lower.indexOf(needle, from))
      .filter(index => index >= 0);
    if (hits.length === 0) break;
    const gap = Math.min(...hits);
    const lineStart = gap + 2;
    const nl = content.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? content.length : nl;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (!isTrailerHeader(line)) {
      from = lineStart;
      continue;
    }
    const refsStart = Math.min(lineEnd + 1, content.length);
    const attachments = content
      .slice(refsStart)
      .split('\n')
      .map(refLine => refLine.trim().replace(/\r$/, ''))
      .filter(refLine => refLine.startsWith('- '))
      .map(refLine => refLine.slice(2).trim())
      .filter(path => path.length > 0)
      .map(path => ({ path, name: attachmentName(path) }));
    if (attachments.length === 0) return { text: content, attachments: [] };
    let body = content.slice(0, gap).trimEnd();
    if (ATTACHMENT_ONLY_BODIES.has(body.trim())) body = '';
    return { text: body, attachments };
  }
  return { text: content, attachments: [] };
};

/** Sidebar/rail label: the prompt, or the file name when the send was files only. */
export const userMessageRailText = (content: string): string => {
  const parsed = parseUserMessageAttachments(content);
  if (parsed.text.trim() !== '') return parsed.text;
  if (parsed.attachments.length === 0) return content;
  if (parsed.attachments.length === 1) return parsed.attachments[0].name;
  return `${parsed.attachments.length} files`;
};
