// Queue actions: enqueue onto the doc's `queue` list, move rows, and the
// host RPC actions (sendNow/steerNow/remove) — a confirmed remove deletes
// the row locally; an unacknowledged one does not (SessionQueue.swift
// performQueueAction).

import { SessionController } from '../src/zeron/runtime/sessionController';
import {
  getSessionStore,
  resetSessionStores,
} from '../src/zeron/state/sessionStores';
import { LoroCrdtAdapter } from '../src/zeron/doc/loroCrdtAdapter';
import { FakeClock } from '../src/zeron/transport/clock';
import { staticTokenSource } from '../src/zeron/transport/tokenSource';
import { FakeWsHub, fakeFetch } from '../src/zeron/testing/fakeWs';
import { memDisk } from '../src/zeron/testing/memDisk';
import type { RelayLike } from '../src/zeron/attachments/upload';

const cfg = { baseUrl: 'https://edge.test' };

const make = (relay?: RelayLike) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const { disk } = memDisk();
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
  });
  return { c, clock };
};

beforeEach(() => resetSessionStores());

test('queueMessage parks a row on the doc queue', async () => {
  const { c } = make();
  const id = c.queueMessage('hold this', { holdForTurnEnd: true });
  const queue = getSessionStore('c1').getState().queue;
  expect(queue.map(q => q.id)).toEqual([id]);
  expect(queue[0].text).toBe('hold this');
  expect(queue[0].holdForTurnEnd).toBe(true);
});

test('queueMessage carries attachments refs', () => {
  const { c } = make();
  c.queueMessage('look', { attachments: ['pending://u1/a.png'] });
  expect(getSessionStore('c1').getState().queue[0].attachments).toEqual([
    'pending://u1/a.png',
  ]);
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
