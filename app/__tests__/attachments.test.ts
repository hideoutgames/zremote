// Attachments: validation matrix, sendPlan routing, chunked upload over a
// fake relay (seq slicing, 3-wide window, retries, commit, abort), escort
// backoff + stash lifecycle, pending:// ref formatting — all deterministic.

import {
  validateStagedAttachment,
  harnessInlinesAttachments,
  isImageMime,
  MAX_ATTACHMENT_BYTES,
} from '../src/zeron/attachments/validate';
import { sendPlan } from '../src/zeron/attachments/sendPlan';
import {
  pendingRef,
  parsePendingRef,
  withAttachments,
  ATTACHMENT_TRAILER_HEADER,
  ATTACHMENT_ONLY_TEXT,
} from '../src/zeron/protocol/messages';
import {
  uploadAttachmentChunked,
  UploadAborted,
  UPLOAD_CHUNK_B64_CHARS,
  UPLOAD_CONCURRENCY,
  attachmentDeadlineMs,
  type RelayLike,
} from '../src/zeron/attachments/upload';
import { AttachmentEscort } from '../src/zeron/attachments/escort';
import { FakeClock } from '../src/zeron/transport/clock';
import { memDisk, flush } from '../src/zeron/testing/memDisk';

// ── Validation ──────────────────────────────────────────────────────────

test('image/png under the cap validates', () => {
  expect(
    validateStagedAttachment({
      name: 'a.png',
      mimeType: 'image/png',
      size: 1000,
    }),
  ).toEqual({ ok: true });
});

test('over the byte cap → tooLarge', () => {
  expect(
    validateStagedAttachment({
      name: 'big.png',
      mimeType: 'image/png',
      size: MAX_ATTACHMENT_BYTES + 1,
    }),
  ).toEqual({ ok: false, reason: 'tooLarge' });
});

test('text/pdf/json under the cap validate (send + local text preview)', () => {
  expect(
    validateStagedAttachment({
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 1000,
    }),
  ).toEqual({ ok: true });
  expect(
    validateStagedAttachment({
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1000,
    }),
  ).toEqual({ ok: true });
  expect(
    validateStagedAttachment({
      name: 'data.json',
      mimeType: 'application/json',
      size: 1000,
    }),
  ).toEqual({ ok: true });
});

test('isImageMime is the composer preview split (fullscreen vs text sheet)', () => {
  expect(isImageMime('image/png')).toBe(true);
  expect(isImageMime('IMAGE/JPEG')).toBe(true);
  expect(isImageMime('application/pdf')).toBe(false);
  expect(isImageMime('application/json')).toBe(false);
  expect(isImageMime('text/plain')).toBe(false);
});

test('harness inline matrix: claude + opencode only', () => {
  expect(harnessInlinesAttachments('claude')).toBe(true);
  expect(harnessInlinesAttachments('claude-code')).toBe(true);
  expect(harnessInlinesAttachments('opencode')).toBe(true);
  expect(harnessInlinesAttachments('codex')).toBe(false);
  expect(harnessInlinesAttachments('gemini')).toBe(false);
});

// ── Send plan ───────────────────────────────────────────────────────────

const QUEUE_CAPS = new Set([
  'message-queue-v1',
  'message-queue-attachments-v1',
]);

test('no attachments → direct', () => {
  expect(sendPlan('working', QUEUE_CAPS, false)).toBe('direct');
});

test('attachments + queue caps → queue (even while live)', () => {
  expect(sendPlan('working', QUEUE_CAPS, true)).toBe('queue');
  expect(sendPlan('idle', QUEUE_CAPS, true)).toBe('queue');
});

test('attachments + live + no queue caps → blocked (never dropped)', () => {
  expect(sendPlan('working', new Set(), true)).toBe('blocked');
  expect(sendPlan('awaitingInput', new Set(), true)).toBe('blocked');
  expect(sendPlan('stopping', new Set(), true)).toBe('blocked');
});

test('attachments + idle + no queue caps → legacy upload-first', () => {
  expect(sendPlan('idle', new Set(), true)).toBe('legacy');
});

// ── pending:// refs + trailer ───────────────────────────────────────────

test('pendingRef round-trips through parsePendingRef', () => {
  const ref = pendingRef('up1', 'photo.png');
  expect(ref).toBe('pending://up1/photo.png');
  expect(parsePendingRef(ref)).toEqual({
    uploadId: 'up1',
    name: 'photo.png',
  });
  expect(parsePendingRef('pending://bad')).toBeUndefined();
  expect(parsePendingRef('/abs/path.png')).toBeUndefined();
});

test('withAttachments appends the trailer; empty text uses the fallback', () => {
  const out = withAttachments('', ['/h/a.png']);
  expect(out).toBe(
    `${ATTACHMENT_ONLY_TEXT}\n\n${ATTACHMENT_TRAILER_HEADER}\n- /h/a.png`,
  );
  expect(withAttachments('hi', ['/h/a.png'])).toContain('- /h/a.png');
});

// ── Chunked upload ──────────────────────────────────────────────────────

class FakeRelay implements RelayLike {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  failures = new Map<number, number>(); // seq → attempts to fail
  inFlight = 0;
  maxInFlight = 0;
  clock?: FakeClock; // unused — kept for clarity
  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'UploadChunk') {
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      const seq = params.seq as number;
      const left = this.failures.get(seq) ?? 0;
      if (left > 0) {
        this.failures.set(seq, left - 1);
        this.inFlight--;
        throw new Error(`seq ${seq} dropped`);
      }
      // Yield so concurrent workers interleave.
      await Promise.resolve();
      this.inFlight--;
      return { ok: true } as T;
    }
    if (method === 'UploadCommit') return { path: '/host/staged/f.png' } as T;
    throw new Error(`unexpected ${method}`);
  }
}

test('upload: base64 sliced at 680k chars, ≤3 in flight, commit lands path', async () => {
  const clock = new FakeClock(0);
  const relay = new FakeRelay();

  const b64 = 'a'.repeat(UPLOAD_CHUNK_B64_CHARS * 3 + 100);
  const progress: number[] = [];
  const path = await uploadAttachmentChunked(relay, 'f.png', 'u1', {
    readBase64: () => Promise.resolve(b64),
    clock,
    onProgress: p => progress.push(p),
  });
  expect(path).toBe('/host/staged/f.png');
  const chunks = relay.calls.filter(c => c.method === 'UploadChunk');
  expect(chunks.length).toBe(4);
  expect(chunks[0].params.seq).toBe(0);
  expect(chunks[3].params.data).toHaveLength(100);
  expect(relay.maxInFlight).toBeLessThanOrEqual(UPLOAD_CONCURRENCY);
  const commit = relay.calls.find(c => c.method === 'UploadCommit');
  expect(commit?.params).toEqual({ uploadId: 'u1', fileName: 'f.png' });
  expect(progress[progress.length - 1]).toBeLessThanOrEqual(0.99);
});

test('upload retries a dropped chunk staggered by seq', async () => {
  const clock = new FakeClock(0);
  const relay = new FakeRelay();

  relay.failures.set(0, 1);
  const done = uploadAttachmentChunked(relay, 'f.png', 'u1', {
    readBase64: () => Promise.resolve('x'.repeat(100)),
    clock,
  });
  await flush();
  clock.advance(10_000);
  await done;
  const chunks = relay.calls.filter(
    c => c.method === 'UploadChunk' && c.params.seq === 0,
  );
  expect(chunks.length).toBe(2);
});

test('upload abort flag stops between chunks/retries', async () => {
  const clock = new FakeClock(0);
  const relay = new FakeRelay();

  relay.failures.set(0, 5); // would retry forever without the abort
  let aborted = false;
  const p = uploadAttachmentChunked(relay, 'f.png', 'u1', {
    readBase64: () => Promise.resolve('x'.repeat(100)),
    clock,
    isAborted: () => aborted,
  });
  await flush();
  aborted = true;
  clock.advance(10_000);
  await expect(p).rejects.toBeInstanceOf(UploadAborted);
});

test('whole-upload deadline scales with chunks, capped at 900s', () => {
  expect(attachmentDeadlineMs(1)).toBe(135_000);
  expect(attachmentDeadlineMs(100)).toBe(900_000);
});

// ── Escort ──────────────────────────────────────────────────────────────

test('escort uploads stashed bytes and clears the stash', async () => {
  const clock = new FakeClock(0);
  const { disk } = memDisk();
  await disk.saveUpload(
    'o1',
    'u1',
    'up1',
    {
      name: 'a.png',
      size: 10,
      chatId: 'c1',
    },
    'AAAA',
  );
  const relay = new FakeRelay();

  const escort = new AttachmentEscort({
    orgId: 'o1',
    userId: 'u1',
    docDisk: disk,
    clock,
    relayFor: () => relay,
  });
  await escort.spawn([{ uploadId: 'up1', name: 'a.png', size: 10 }]);
  expect(relay.calls.some(c => c.method === 'UploadCommit')).toBe(true);
  expect(await disk.loadUpload('o1', 'u1', 'up1')).toBeUndefined();
  expect(await disk.listUploads('o1', 'u1')).toEqual([]);
});

test('escort retries with doubling backoff when the relay is down', async () => {
  const clock = new FakeClock(0);
  const { disk } = memDisk();
  await disk.saveUpload(
    'o1',
    'u1',
    'up1',
    {
      name: 'a.png',
      size: 4,
      chatId: 'c1',
    },
    'AAAA',
  );
  let attempts = 0;
  const flaky: RelayLike = {
    call: async <T>(): Promise<T> => {
      attempts++;
      if (attempts < 3) throw new Error('relay down');
      return { path: '/h/a.png' } as T;
    },
  };
  const escort = new AttachmentEscort({
    orgId: 'o1',
    userId: 'u1',
    docDisk: disk,
    clock,
    relayFor: () => flaky,
  });
  const done = escort.spawn([{ uploadId: 'up1', name: 'a.png', size: 4 }]);
  await flush();
  // First backoff: 2s, then 4s — advance past both.
  clock.advance(2_500);
  await flush();
  clock.advance(4_500);
  await flush();
  await done;
  // attempts = 2 failed chunks + 1 landed chunk + 1 commit call.
  expect(attempts).toBe(4);
  expect(await disk.loadUpload('o1', 'u1', 'up1')).toBeUndefined();
});

test('escort dedupes concurrent spawn on the same uploadId', async () => {
  const clock = new FakeClock(0);
  const { disk } = memDisk();
  await disk.saveUpload(
    'o1',
    'u1',
    'up1',
    {
      name: 'a.png',
      size: 4,
      chatId: 'c1',
    },
    'AAAA',
  );
  const relay = new FakeRelay();

  const escort = new AttachmentEscort({
    orgId: 'o1',
    userId: 'u1',
    docDisk: disk,
    clock,
    relayFor: () => relay,
  });
  await Promise.all([
    escort.spawn([{ uploadId: 'up1', name: 'a.png', size: 4 }]),
    escort.spawn([{ uploadId: 'up1', name: 'a.png', size: 4 }]),
  ]);
  expect(relay.calls.filter(c => c.method === 'UploadCommit').length).toBe(1);
});
