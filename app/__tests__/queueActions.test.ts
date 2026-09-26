// Queue actions: enqueue onto the doc's `queue` list, move rows, and the
// host RPC actions (sendNow/steerNow/remove) — a confirmed remove deletes
// the row locally; an unacknowledged one does not (SessionQueue.swift
// performQueueAction).

import { SessionController } from '../src/zeron/runtime/sessionController';
import { SessionDoc } from '../src/zeron/doc/sessionDoc';
import {
  getSessionStore,
  resetSessionStores,
} from '../src/zeron/state/sessionStores';
import { LoroCrdtAdapter } from '../src/zeron/doc/loroCrdtAdapter';
import { FakeClock } from '../src/zeron/transport/clock';
import { staticTokenSource } from '../src/zeron/transport/tokenSource';
import { FakeWsHub, fakeFetch } from '../src/zeron/testing/fakeWs';
import { memDisk, flush } from '../src/zeron/testing/memDisk';
import type { RelayLike } from '../src/zeron/attachments/upload';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import {
  bindQueuedLocal,
  localQueuedFor,
  resetQueuedLocal,
} from '../src/zeron/state/queuedLocalStore';
import { queuedLocalPath } from '../src/zeron/native/docDisk';
import { stageAttachments, resetDrafts } from '../src/zeron/state/draftStore';
import { ATTACHMENT_ONLY_TEXT } from '../src/zeron/protocol/messages';

const cfg = { baseUrl: 'https://edge.test' };

const make = (
  relay?: RelayLike,
  extra: Partial<ConstructorParameters<typeof SessionController>[1]> = {},
) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const { fs, disk } = memDisk();
  const c = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: hub.factory,
    clock,
    docDisk: disk,
    loro: () => new LoroCrdtAdapter(),
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 2 }),
    relayFor: () => relay,
    ...extra,
  });
  return { c, clock, disk, fs };
};

beforeEach(() => {
  resetSessionStores();
  resetQueuedLocal();
  resetDrafts();
  workspaceStore.setState({
    presence: { host1: 1_000_000 },
    devices: [],
    spaces: [],
    chats: [],
    sessions: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

test('queueMessage parks a row on the doc queue', async () => {
  const { c } = make();
  const id = c.queueMessage('hold this', { holdForTurnEnd: true });
  const queue = getSessionStore('c1').getState().queue;
  expect(queue.map(q => q.id)).toEqual([id]);
  expect(queue[0].text).toBe('hold this');
  expect(queue[0].holdForTurnEnd).toBe(true);
});

test('queueMessage carries committed attachment paths, not a trailer in text', () => {
  const { c } = make();
  c.queueMessage('look', { attachments: ['/host/uploads/a.png'] });
  const row = getSessionStore('c1').getState().queue[0];
  expect(row.attachments).toEqual(['/host/uploads/a.png']);
  // The host copies `attachments` into the prompt at drain
  // (doc_host.rs queued_message_prompt) and does not rewrite pending://,
  // so the row must already name a real host path. Text stays editable.
  expect(row.text).toBe('look');
});

test('moveQueued reorders locally; bad id is a no-op', () => {
  const { c } = make();
  const a = c.queueMessage('a');
  const b = c.queueMessage('b');
  expect(c.moveQueued(b, 0)).toBe(true);
  expect(
    getSessionStore('c1')
      .getState()
      .queue.map(q => q.id),
  ).toEqual([b, a]);
  expect(c.moveQueued('nope', 0)).toBe(false);
});

test('sendNow sends SendQueuedMessageNow {chatId,id}; ack → true', async () => {
  const calls: { method: string; params: unknown }[] = [];
  const relay: RelayLike = {
    call: async <T>(m: string, p: Record<string, unknown>): Promise<T> => {
      calls.push({ method: m, params: p });
      return { sent: true } as T;
    },
  };
  const { c } = make(relay);
  const id = c.queueMessage('go');
  await expect(c.queueAction(id, 'sendNow')).resolves.toBe(true);
  expect(calls[0]).toEqual({
    method: 'SendQueuedMessageNow',
    params: { chatId: 'c1', id },
  });
  // Sends leave the row to sync — still queued locally.
  expect(getSessionStore('c1').getState().queue.length).toBe(1);
});

test('confirmed remove deletes the row locally', async () => {
  const relay: RelayLike = { call: async () => ({ removed: true } as never) };
  const { c } = make(relay);
  const id = c.queueMessage('gone');
  await expect(c.queueAction(id, 'remove')).resolves.toBe(true);
  expect(getSessionStore('c1').getState().queue.length).toBe(0);
});

test('unacked action keeps the row and records the error', async () => {
  const relay: RelayLike = { call: async () => ({ sent: false } as never) };
  const { c } = make(relay);
  const id = c.queueMessage('stay');
  await expect(c.queueAction(id, 'remove')).resolves.toBe(false);
  const s = getSessionStore('c1').getState();
  expect(s.queue.length).toBe(1);
  expect(s.queueActionError).toContain('did not confirm');
});

test('delivery-gated rows reject sendNow but allow remove', async () => {
  const relay: RelayLike = { call: async () => ({ removed: true } as never) };
  const { c } = make(relay);
  // Simulate a gated row via the doc projection.
  const id = c.queueMessage('gated');
  getSessionStore('c1').setState(s => ({
    queue: s.queue.map(q =>
      q.id === id
        ? {
            ...q,
            deliveryGate: {
              kind: 'reviewRequired' as const,
              previousLeaseId: 'l1',
            } as never,
          }
        : q,
    ),
  }));
  await expect(c.queueAction(id, 'sendNow')).resolves.toBe(false);
  await expect(c.queueAction(id, 'remove')).resolves.toBe(true);
});

test('no host relay → action fails and records the error', async () => {
  const { c } = make(undefined);
  const id = c.queueMessage('x');
  await expect(c.queueAction(id, 'sendNow')).resolves.toBe(false);
  expect(getSessionStore('c1').getState().queueActionError).toBeTruthy();
  expect(getSessionStore('c1').getState().queueActionsPending.size).toBe(0);
});

test('offline queueMessage writes sidecar immediately; online enqueue does not', async () => {
  const { c, disk, fs, clock } = make();
  await bindQueuedLocal(disk, 'o1', 'u1');
  workspaceStore.setState({ presence: {} });
  const id = c.queueMessage('parked');
  await flush();
  expect(localQueuedFor('c1').map(q => q.id)).toEqual([id]);
  const path = queuedLocalPath('/docs', 'o1', 'u1');
  const saved = JSON.parse(fs.files.get(path)!) as Record<
    string,
    { id: string }[]
  >;
  expect(saved.c1.map(q => q.id)).toEqual([id]);

  workspaceStore.setState({ presence: { host1: clock.now() } });
  c.queueMessage('live');
  await flush();
  expect(localQueuedFor('c1').map(q => q.id)).toEqual([id]);
});

test('offline queue survives a controller restart via chat2 + sidecar', async () => {
  const { c, disk } = make();
  await bindQueuedLocal(disk, 'o1', 'u1');
  workspaceStore.setState({ presence: {} });
  const id = c.queueMessage('keep me');
  await flush();
  await c.flush();
  c.stop();
  resetSessionStores();
  resetQueuedLocal();

  await bindQueuedLocal(disk, 'o1', 'u1');
  const c2 = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: new FakeWsHub().factory,
    clock: new FakeClock(1_000_000),
    docDisk: disk,
    loro: () => new LoroCrdtAdapter(),
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 1 }),
  });
  await c2.start();
  await flush();
  expect(
    getSessionStore('c1')
      .getState()
      .queue.map(q => q.id),
  ).toEqual([id]);
  expect(localQueuedFor('c1').map(q => q.id)).toEqual([id]);
  c2.stop();
});

test('confirmed remove and sendNow drop the sidecar id', async () => {
  const relay: RelayLike = {
    call: async () => ({ sent: true, removed: true } as never),
  };
  const { c, disk } = make(relay);
  await bindQueuedLocal(disk, 'o1', 'u1');
  workspaceStore.setState({ presence: {} });
  const gone = c.queueMessage('gone');
  await flush();
  expect(localQueuedFor('c1').map(q => q.id)).toEqual([gone]);
  await expect(c.queueAction(gone, 'remove')).resolves.toBe(true);
  expect(localQueuedFor('c1')).toEqual([]);

  const send = c.queueMessage('send');
  await flush();
  workspaceStore.setState({ presence: { host1: 1_000_000 } });
  await expect(c.queueAction(send, 'sendNow')).resolves.toBe(true);
  expect(localQueuedFor('c1')).toEqual([]);
});

test('relay parks locally when the host is offline and flushes on reconnect', async () => {
  const calls: { method: string; params: unknown }[] = [];
  const relay: RelayLike = {
    call: async <T>(m: string, p: Record<string, unknown>): Promise<T> => {
      calls.push({ method: m, params: p });
      return { id: 'host-q' } as T;
    },
  };
  const clock = new FakeClock(1_000_000);
  const { disk, fs } = memDisk();
  await bindQueuedLocal(disk, 'o1', 'u1');
  workspaceStore.setState({ presence: {} });
  const c = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: new FakeWsHub().factory,
    clock,
    docDisk: disk,
    loro: () => new LoroCrdtAdapter(),
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 2 }),
    relayFor: () => relay,
    sessionMode: 'relay',
  });
  const id = c.queueMessage('offline relay');
  await flush();
  expect(id).toBeTruthy();
  expect(
    getSessionStore('c1')
      .getState()
      .queue.map(q => q.text),
  ).toEqual(['offline relay']);
  expect(localQueuedFor('c1')[0]?.text).toBe('offline relay');
  expect(calls).toEqual([]);

  workspaceStore.setState({ presence: { host1: clock.now() } });
  await c.flushLocalQueue();
  await flush();
  expect(calls[0]?.method).toBe('QueueMessage');
  expect(localQueuedFor('c1')).toEqual([]);
  expect(fs.files.get(queuedLocalPath('/docs', 'o1', 'u1'))).toBe('{}');
  c.stop();
});

// ── sendWithAttachments (upload, then queue with host paths) ──────────────

const uploadRelay = (): RelayLike & {
  calls: { method: string; params: Record<string, unknown> }[];
} => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    call: async <T>(
      method: string,
      params: Record<string, unknown>,
    ): Promise<T> => {
      calls.push({ method, params });
      if (method === 'UploadChunk') return { ok: true } as T;
      if (method === 'UploadCommit')
        return { path: `/host/uploads/${String(params.fileName)}` } as T;
      throw new Error(`unexpected ${method}`);
    },
  };
};

const QUEUE_CAPS = new Set([
  'message-queue-v1',
  'message-queue-attachments-v1',
]);

const stagedPng = (chatId = 'c1') =>
  stageAttachments(chatId, [
    {
      kind: 'file',
      name: 'a.png',
      mimeType: 'image/png',
      size: 4,
      localUri: 'file:///cache/a.png',
    },
  ]);

test('sendWithAttachments on a queue-capable host uploads, then queues the host path', async () => {
  const relay = uploadRelay();
  const { c, disk } = make(relay, {
    hostCapabilities: () => QUEUE_CAPS,
    readFileBase64: async () => 'AAA=',
  });
  const staged = stagedPng();
  const plan = await c.sendWithAttachments('see this', {}, staged, {
    phase: 'idle',
  });
  expect(plan).toBe('queue');
  const row = getSessionStore('c1').getState().queue[0];
  // The row keeps the raw text — the host expands the trailer at drain.
  // The path is the committed host file, never pending://.
  expect(row.text).toBe('see this');
  expect(row.attachments).toEqual(['/host/uploads/a.png']);
  expect(relay.calls.some(call => call.method === 'UploadCommit')).toBe(true);
  expect(await disk.loadUpload('o1', 'u1', staged[0].id)).toBeUndefined();
  c.stop();
});

test('attachment-only queue send substitutes the fallback text', async () => {
  const { c } = make(uploadRelay(), {
    hostCapabilities: () => QUEUE_CAPS,
    readFileBase64: async () => 'AAA=',
  });
  const staged = stagedPng();
  const plan = await c.sendWithAttachments('', {}, staged, {
    phase: 'idle',
  });
  expect(plan).toBe('queue');
  const queue = getSessionStore('c1').getState().queue;
  // queuedFrom drops empty-text rows on both ends — an attachment-only
  // message must land a body (same as withAttachments('', …)).
  expect(queue).toHaveLength(1);
  expect(queue[0].text).toBe(ATTACHMENT_ONLY_TEXT);
  expect(queue[0].attachments).toEqual(['/host/uploads/a.png']);
  c.stop();
});

test('forceQueue on a host without queue-attachments caps blocks instead of leaking pending:// refs', async () => {
  const clock = new FakeClock(1_000_000);
  const { disk } = memDisk();
  const c = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: new FakeWsHub().factory,
    clock,
    docDisk: disk,
    loro: () => new LoroCrdtAdapter(),
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 2 }),
    readFileBase64: async () => 'AAA=',
    // No hostCapabilities → sendPlan('idle', ∅, attachments) → 'legacy'.
  });
  const staged = stagedPng();
  const plan = await c.sendWithAttachments('hi', {}, staged, {
    phase: 'idle',
    forceQueue: true,
  });
  expect(plan).toBe('blocked');
  // Nothing parked: no queue row, no upload stash.
  expect(getSessionStore('c1').getState().queue).toEqual([]);
  expect(await disk.listUploads('o1', 'u1')).toEqual([]);
  c.stop();
});

test('forceQueue without a relay parks pending refs off the doc, then flush uploads them', async () => {
  const port = new LoroCrdtAdapter();
  let relay: RelayLike | undefined;
  const { c, disk } = make(undefined, {
    hostCapabilities: () => QUEUE_CAPS,
    readFileBase64: async () => 'AAA=',
    loro: () => port,
    relayFor: () => relay,
  });
  const staged = stagedPng();
  const plan = await c.sendWithAttachments('hi', {}, staged, {
    phase: 'idle',
    forceQueue: true,
  });
  expect(plan).toBe('queue');
  // Visible in the queue, but not written where the host would copy
  // pending:// into the prompt.
  const row = getSessionStore('c1').getState().queue[0];
  expect(row.attachments).toEqual([`pending://${staged[0].id}/a.png`]);
  expect(new SessionDoc(port).project()?.queue ?? []).toEqual([]);
  expect(await disk.loadUpload('o1', 'u1', staged[0].id)).toBe('AAA=');

  relay = uploadRelay();
  await c.flushLocalQueue();
  const queued = new SessionDoc(port).project()?.queue ?? [];
  expect(queued).toHaveLength(1);
  expect(queued[0].text).toBe('hi');
  expect(queued[0].attachments).toEqual(['/host/uploads/a.png']);
  expect(localQueuedFor('c1')).toEqual([]);
  expect(await disk.loadUpload('o1', 'u1', staged[0].id)).toBeUndefined();
  c.stop();
});

test('relay-mode offline send parks the attachment row in the sidecar', async () => {
  const clock = new FakeClock(1_000_000);
  const { disk } = memDisk();
  await bindQueuedLocal(disk, 'o1', 'u1');
  workspaceStore.setState({ presence: {} });
  const c = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: new FakeWsHub().factory,
    clock,
    docDisk: disk,
    loro: () => {
      throw new Error('no loro in relay mode');
    },
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 2 }),
    relayFor: () => undefined,
    readFileBase64: async () => 'AAA=',
    hostCapabilities: () => QUEUE_CAPS,
    sessionMode: 'relay',
  });
  const staged = stagedPng();
  // Without the sidecar guard this threw 'host offline' and orphaned the
  // stash; now it parks like queueMessage does.
  const plan = await c.sendWithAttachments('', {}, staged, {
    phase: 'idle',
    forceQueue: true,
  });
  expect(plan).toBe('queue');
  await flush();
  const rows = localQueuedFor('c1');
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe(ATTACHMENT_ONLY_TEXT);
  expect(rows[0].attachments).toEqual([`pending://${staged[0].id}/a.png`]);
  expect(await disk.loadUpload('o1', 'u1', staged[0].id)).toBeDefined();
  c.stop();
});
