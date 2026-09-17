// Chunked attachment upload — port of
// apps/ios/Zeron/Composer/Attachments.swift `uploadAttachmentChunked`
// (PR #164 shape) over DeviceRelayClient:
//   - base64 slices as `UploadChunk {uploadId, seq, data}`, positional `seq`
//     makes retries idempotent,
//   - 3 chunks in flight, first window racing the cold-dial 90s deadline,
//     later chunks 30s,
//   - ≤3 attempts per chunk, backoff 50ms·attempt·(seq+1) so a failed window
//     doesn't re-collide in lockstep,
//   - `UploadCommit {uploadId, fileName}` (150s) → durable host path,
//   - whole-upload deadline min(120 + 15·chunks, 900)s,
//   - progress = fraction of committed binary bytes, clamped at 0.99.
//
// The caller mints `uploadId` — on the queued flow it is the `pending://`
// ref's identity and retries must re-commit the same file.

import type { Clock } from '../transport/clock';
import { systemClock } from '../transport/clock';

/** attachments.rs UPLOAD_CHUNK_B64_CHARS: ≈510KB binary per chunk — sized to
 * clear Cloudflare's 1MiB WS cap with envelope headroom; % 4 == 0 so every
 * slice decodes independently. */
export const UPLOAD_CHUNK_B64_CHARS = 680_000;
/** 3 in flight (attachments.rs UPLOAD_CONCURRENCY); seq slots are positional. */
export const UPLOAD_CONCURRENCY = 3;

export const UPLOAD_FIRST_WINDOW_TIMEOUT_MS = 90_000;
export const UPLOAD_CHUNK_TIMEOUT_MS = 30_000;
export const UPLOAD_COMMIT_TIMEOUT_MS = 150_000;
export const UPLOAD_MAX_ATTEMPTS = 3;

/** attachments.rs `attachment_deadline`: a lawful crawl must FAIL visibly. */
export const attachmentDeadlineMs = (chunkCount: number): number =>
  Math.min(120 + 15 * chunkCount, 900) * 1000;

export class UploadAborted extends Error {
  constructor() {
    super('upload aborted');
    this.name = 'UploadAborted';
  }
}

const sleep = (clock: Clock, ms: number): Promise<void> =>
  new Promise(resolve => clock.setTimeout(resolve, ms));

export interface RelayLike {
  call<T>(
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<T>;
}

export interface UploadDeps {
  /** Returns the WHOLE file as base64 — slices are cut from it at 680k-char
   * boundaries (each maps to a %3-aligned binary range, so per-slice base64
   * concatenates to the file's). */
  readBase64: () => Promise<string>;
  clock?: Clock;
  /** Checked between chunks and before each retry — set to cancel. */
  isAborted?: () => boolean;
  onProgress?: (fraction: number) => void;
}

/** Upload `name`'s bytes to the host; resolves to the committed absolute
 * host path. Throws UploadAborted, RelayError, or a deadline Error. */
export const uploadAttachmentChunked = async (
  relay: RelayLike,
  name: string,
  uploadId: string,
  deps: UploadDeps,
): Promise<string> => {
  const clock = deps.clock ?? systemClock;
  const aborted = deps.isAborted ?? (() => false);
  const b64 = await deps.readBase64();
  if (aborted()) throw new UploadAborted();

  // Slice the BASE64 at UPLOAD_CHUNK_B64_CHARS — each slice's bytes are an
  // independent %3-aligned binary range, so slices decode independently and
  // concatenate to the whole file (Attachments.swift slices the binary at
  // 510000B and encodes per slice; equivalent output).
  const ranges: string[] = [];
  // An empty file still sends one empty chunk (the commit needs the uploadId
  // staged); an exact multiple gets no trailing empty chunk.
  for (
    let off = 0;
    off < Math.max(b64.length, 1);
    off += UPLOAD_CHUNK_B64_CHARS
  )
    ranges.push(b64.slice(off, off + UPLOAD_CHUNK_B64_CHARS));

  let doneBytes = 0;
  const totalBytes = Math.max(Math.floor((b64.length / 4) * 3), 1);

  const pushChunk = async (seq: number, data: string): Promise<void> => {
    const timeoutMs =
      seq < UPLOAD_CONCURRENCY
        ? UPLOAD_FIRST_WINDOW_TIMEOUT_MS
        : UPLOAD_CHUNK_TIMEOUT_MS;
    for (let attempt = 1; ; attempt++) {
      if (aborted()) throw new UploadAborted();
      try {
        await relay.call<{ ok?: boolean }>(
          'UploadChunk',
          { uploadId, seq, data },
          { timeoutMs },
        );
        break;
      } catch (e) {
        if (aborted()) throw new UploadAborted();
        if (attempt >= UPLOAD_MAX_ATTEMPTS) throw e;
        // Staggered by seq — a window that failed together must not retry
        // in lockstep.
        await sleep(clock, 50 * attempt * (seq + 1));
      }
    }
    doneBytes += Math.floor((data.length / 4) * 3);
    deps.onProgress?.(Math.min(doneBytes / totalBytes, 0.99));
  };

  // 3-wide sliding window, then the commit (which outlasts the engine's
  // assemble + best-effort mirror).
  const uploadAll = async (): Promise<string> => {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ranges.length) {
        const seq = next++;
        await pushChunk(seq, ranges[seq]);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, ranges.length) },
        worker,
      ),
    );
    if (aborted()) throw new UploadAborted();
    const reply = await relay.call<{ path: string }>(
      'UploadCommit',
      { uploadId, fileName: name },
      { timeoutMs: UPLOAD_COMMIT_TIMEOUT_MS },
    );
    return reply.path;
  };

  const deadline = attachmentDeadlineMs(ranges.length);
  let timer: unknown;
  const timeout = new Promise<never>((_, reject) => {
    timer = clock.setTimeout(
      () => reject(new Error(`upload ${uploadId}: deadline exceeded`)),
      deadline,
    );
  });
  try {
    return await Promise.race([uploadAll(), timeout]);
  } finally {
    clock.clearTimeout(timer);
  }
};
