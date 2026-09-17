// registryClient: hello/cursor handshake, state→push→ack, presence beats,
// silence/probe/hello deadlines, backoff, HTTP fallback — all deterministic
// on FakeClock + FakeWs.

import type { Op } from '../../protocol/registryCore';
import type { RegistryPendingBatch } from '../../doc/registryDoc';
import { FakeClock } from '../clock';
import { staticTokenSource } from '../tokenSource';
import {
  RegistryClient,
  type RegistryDelegate,
  type RegistryEvent,
} from '../registryClient';
import { FakeWs, FakeWsHub, fakeFetch } from '../../testing/fakeWs';

const cfg = { baseUrl: 'https://edge.test' };

const op: Op = {
  kind: 'chat',
  id: 'c1',
  op: 'upsert',
  hlc: '0000000001000-000000-d1',
  set: { title: 'x' },
};

const makeBatch = (batch: string): RegistryPendingBatch => ({
  batch,
  ops: [op],
  inFlight: false,
});

const stateFrame = (seq = 3) =>
  JSON.stringify({
    t: 'state',
    seq,
    full: true,
    gcFloor: 0,
    rows: [],
    presence: {},
  });

class FakeDelegate implements RegistryDelegate {
  events: RegistryEvent[] = [];
  cursor: number | undefined = 7;
  pushable: RegistryPendingBatch[] = [];
  helloCursor(): number | undefined {
    return this.cursor;
  }
  takePushable(): RegistryPendingBatch[] {
    const out = this.pushable;
    this.pushable = [];
    return out;
  }
  onEvent(e: RegistryEvent): void {
    this.events.push(e);
  }
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeClient = (
  opts: {
    clock?: FakeClock;
    delegate?: FakeDelegate;
    fetchImpl?: ReturnType<typeof fakeFetch>['fetchImpl'];
  } = {},
) => {
  const clock = opts.clock ?? new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const delegate = opts.delegate ?? new FakeDelegate();
  const client = new RegistryClient({
    cfg,
    orgId: 'o1',
    deviceId: 'd1',
    wsFactory: hub.factory,
    tokenSource: staticTokenSource('u@o1'),
    clock,
    delegate,
    fetchImpl: opts.fetchImpl,
  });
  return { client, clock, hub, delegate };
};

const sentJson = (ws: FakeWs): Record<string, unknown>[] =>
  ws.sent
    .filter((s): s is string => typeof s === 'string')
    .filter(s => s !== 'ping')
    .map(s => JSON.parse(s) as Record<string, unknown>);

/** Dial → open → answer the hello with a state frame. */
const join = async (c: ReturnType<typeof makeClient>, seq = 3) => {
  c.client.start();
  await flush();
  c.hub.latest.open();
  c.hub.latest.receive(stateFrame(seq));
};

describe('RegistryClient handshake', () => {
  test('hello carries the persisted cursor and device', async () => {
    const c = makeClient();
    c.client.start();
    await flush();
    const ws = c.hub.latest;
    expect(ws.url).toBe('wss://edge.test/registry/o1/ws?device=d1');
    expect(ws.headers.Authorization).toBe('Bearer u@o1');
    ws.open();
    const hello = sentJson(ws).find(f => f.t === 'hello');
    expect(hello).toMatchObject({ cursor: 7, device: 'd1' });
  });

  test('state event reaches the delegate, then connected; pending ops push', async () => {
    const delegate = new FakeDelegate();
    delegate.pushable = [makeBatch('b1')];
    const c = makeClient({ delegate });
    await join(c);
    const types = delegate.events.map(e => e.t);
    expect(types).toEqual(['state', 'connected']);
    const push = sentJson(c.hub.latest).find(f => f.t === 'push');
    expect(push).toMatchObject({ batch: 'b1' });
    expect((push?.ops as unknown[]).length).toBe(1);
    // An immediate presence beat announces the device on join.
    expect(sentJson(c.hub.latest).some(f => f.t === 'presence')).toBe(true);
  });

  test('ack and rows frames surface as delegate events', async () => {
    const c = makeClient();
    await join(c);
    c.hub.latest.receive(
      JSON.stringify({ t: 'ack', batch: 'b1', seq: 9, applied: 1 }),
    );
    c.hub.latest.receive(
      JSON.stringify({
        t: 'rows',
        seq: 10,
        rows: [
          {
            kind: 'chat',
            id: 'c1',
            seq: 10,
            deleted: false,
            fields: {},
            clocks: {},
          },
        ],
      }),
    );
    expect(c.delegate.events).toContainEqual({
      t: 'ack',
      batch: 'b1',
      seq: 9,
      applied: 1,
    });
    expect(c.delegate.events).toContainEqual(
      expect.objectContaining({ t: 'rows', seq: 10 }),
    );
  });
});

describe('RegistryClient liveness', () => {
  test('presence beat cadence: one presence frame per 15s tick', async () => {
    const c = makeClient();
    await join(c);
    const ws = c.hub.latest;
    const before = sentJson(ws).filter(f => f.t === 'presence').length;
    c.clock.advance(15_000);
    c.clock.advance(15_000);
    const beats = sentJson(ws).filter(f => f.t === 'presence').length - before;
    expect(beats).toBe(2);
  });

  test('hello unanswered past its deadline tears the session down', async () => {
    const c = makeClient();
    c.client.start();
    await flush();
    c.hub.latest.open(); // hello sent, never answered
    c.clock.advance(16_000);
    expect(c.delegate.events.map(e => e.t)).toContain('disconnected');
    // A reconnect is scheduled on backoff; the next dial lands ~250ms later.
    const n = c.hub.sockets.length;
    c.clock.advance(300);
    await flush();
    expect(c.hub.sockets.length).toBe(n + 1);
  });

  test('socket silence past the 45s lease tears down; backoff doubles', async () => {
    const c = makeClient();
    await join(c);
    // Silence: the lease is checked on the 15s ping tick, so the teardown
    // lands on the first tick past 45s of silence — the 60s tick.
    c.clock.advance(61_000);
    expect(c.delegate.events.map(e => e.t)).toContain('disconnected');
    // Backoff progression: 250 → 500 → 1000 …
    c.clock.advance(300);
    await flush();
    expect(c.hub.sockets.length).toBe(2);
    // Drop the second dial before hello answers → 500ms backoff.
    c.hub.latest.drop();
    c.clock.advance(400);
    await flush();
    expect(c.hub.sockets.length).toBe(2); // not yet (500ms)
    c.clock.advance(150);
    await flush();
    expect(c.hub.sockets.length).toBe(3);
  });

  test('kick on a joined quiet socket sends a probe; an unanswered probe redials', async () => {
    const c = makeClient();
    await join(c);
    c.client.kick();
    expect(sentJson(c.hub.latest).some(f => f.t === 'probe')).toBe(true);
    c.clock.advance(11_000); // past the 10s probe deadline
    expect(c.delegate.events.map(e => e.t)).toContain('disconnected');
  });

  test('a probe-ok clears the probe deadline', async () => {
    const c = makeClient();
    await join(c);
    c.client.kick();
    c.hub.latest.receive(JSON.stringify({ t: 'probe-ok', seq: 5 }));
    c.clock.advance(11_000);
    expect(c.delegate.events.map(e => e.t)).not.toContain('disconnected');
  });
});

describe('RegistryClient HTTP fallback', () => {
  test('pushPendingOverHTTP POSTs batches and acks them via the delegate', async () => {
    const delegate = new FakeDelegate();
    delegate.pushable = [makeBatch('hb')];
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      text: async () => JSON.stringify({ seq: 11, applied: 1 }),
    }));
    const c = makeClient({ delegate, fetchImpl });
    await c.client.pushPendingOverHTTP();
    expect(calls[0].url).toBe('https://edge.test/registry/o1/push?device=d1');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      batch: 'hb',
    });
    expect(delegate.events).toContainEqual({
      t: 'ack',
      batch: 'hb',
      seq: 11,
      applied: 1,
    });
  });

  test('pullDelta GETs rows?since=cursor', async () => {
    const delegate = new FakeDelegate();
    delegate.cursor = 42;
    const { fetchImpl, calls } = fakeFetch(() => ({
      status: 200,
      text: async () =>
        JSON.stringify({ seq: 50, full: false, gcFloor: 0, rows: [] }),
    }));
    const c = makeClient({ delegate, fetchImpl });
    const out = await c.client.pullDelta();
    expect(calls[0].url).toContain(
      '/registry/o1/rows?device=d1&beat=1&since=42',
    );
    expect(out?.seq).toBe(50);
  });
});
