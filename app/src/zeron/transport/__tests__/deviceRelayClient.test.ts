// deviceRelayClient: unary ok/err, stream items/done/cancel, retry policy
// (hostOffline/notConnected only), relay-kind teardown, echo feature
// detection + deadline, dark-liveness fast fail, header byte shape.

import { DeviceRelayClient, PING_INTERVAL_MS } from '../deviceRelayClient';
import {
  RPC_FRAME_HEADER,
  decodeFrame,
  encodeFrame,
} from '../../protocol/deviceFrames';
import { FakeClock } from '../clock';
import { staticTokenSource } from '../tokenSource';
import { FakeWs, FakeWsHub } from '../../testing/fakeWs';

const cfg = { baseUrl: 'https://edge.test' };

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

const makeClient = (
  opts: { liveness?: () => 'live' | 'dark' | 'unknown' } = {},
) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const client = new DeviceRelayClient({
    cfg,
    deviceId: 'dev1',
    wsFactory: hub.factory,
    tokenSource: staticTokenSource('u@o1'),
    clock,
    liveness: opts.liveness,
  });
  return { client, clock, hub };
};

const rpcReply = (ws: FakeWs, obj: unknown) =>
  ws.receive(
    encodeFrame(
      RPC_FRAME_HEADER,
      new TextEncoder().encode(JSON.stringify(obj) + '\n'),
    ),
  );

/** The bytes of the k-th sent frame, decoded. */
const sentFrame = (ws: FakeWs, k: number) => {
  const bytes = ws.sent[k];
  if (!(bytes instanceof Uint8Array)) throw new Error('expected binary frame');
  return decodeFrame(bytes);
};

/** Dial: start a call, then open the socket the factory produced. */
const dial = async (c: ReturnType<typeof makeClient>) => {
  const p = c.client.call('engine.ping', {});
  await flush();
  const ws = c.hub.latest;
  ws.open();
  await flush();
  return { p, ws };
};

describe('DeviceRelayClient unary', () => {
  test('connects on demand with role=client, a fresh connId, and an echo on open', async () => {
    const c = makeClient();
    const { p, ws } = await dial(c);
    expect(ws.url).toContain('/device/dev1/ws?role=client&connId=');
    expect(ws.headers.Authorization).toBe('Bearer u@o1');
    // sent[0] is the on-open echo frame.
    expect(sentFrame(ws, 0)?.header).toMatchObject({ s: 'echo', k: 'echo' });
    rpcReply(ws, { id: 1, ok: { pong: true } });
    await expect(await p).toEqual({ pong: true });
  });

  test('request frames carry the exact {"s":"rpc","k":"rpc"} header bytes', async () => {
    const c = makeClient();
    const { p, ws } = await dial(c);
    const raw = ws.sent[1] as Uint8Array;
    const text = new TextDecoder().decode(raw);
    expect(text.startsWith('\x15' + RPC_FRAME_HEADER)).toBe(true);
    expect(sentFrame(ws, 1)?.header).toEqual({ s: 'rpc', k: 'rpc' });
    rpcReply(ws, { id: 1, ok: null });
    await p;
  });

  test('err reply rejects with kind rpc and is NOT retried', async () => {
    const c = makeClient();
    const { p, ws } = await dial(c);
    rpcReply(ws, { id: 1, err: 'bad method' });
    await expect(p).rejects.toMatchObject({
      kind: 'rpc',
      message: 'bad method',
    });
    expect(c.hub.sockets).toHaveLength(1);
  });

  test('timeout tears down the link and rejects with kind timeout', async () => {
    const c = makeClient();
    const { p } = await dial(c);
    p.catch(() => {}); // observed below — avoids an unhandled rejection
    c.clock.advance(10_001);
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
    // The link was dropped as suspect; the next call re-dials.
    const p2 = c.client.call('engine.ping', {});
    await flush();
    expect(c.hub.sockets.length).toBe(2);
    c.hub.latest.open();
    await flush();
    rpcReply(c.hub.latest, { id: 2, ok: 1 });
    await p2;
  });

  test('hostOffline retries up to 3 attempts on fresh dials', async () => {
    const c = makeClient();
    const { p } = await dial(c);
    // Host goes offline mid-call: relay-kind frame kills the link.
    c.hub.latest.receive(
      encodeFrame(
        '{"s":"relay","k":" relay"}',
        new TextEncoder().encode('{"error":"host_offline"}'),
      ),
    );
    await flush();
    // Attempt 2 after 250ms backoff.
    c.clock.advance(300);
    await flush();
    expect(c.hub.sockets).toHaveLength(2);
    c.hub.latest.open();
    await flush();
    // Second socket drops too.
    c.hub.latest.drop();
    await flush();
    c.clock.advance(600);
    await flush();
    expect(c.hub.sockets).toHaveLength(3);
    c.hub.latest.open();
    await flush();
    // Third attempt succeeds (new connection → id 3).
    rpcReply(c.hub.latest, { id: 3, ok: 'done' });
    await expect(await p).toBe('done');
  });

  test('dark liveness fails fast with ZERO dials', async () => {
    const c = makeClient({ liveness: () => 'dark' });
    const p = c.client.call('engine.ping', {});
    p.catch(() => {});
    // Each attempt fails at the dial gate; advance through the retry sleeps.
    await flush();
    c.clock.advance(300);
    await flush();
    c.clock.advance(600);
    await flush();
    await expect(p).rejects.toMatchObject({ kind: 'hostOffline' });
    expect(c.hub.sockets).toHaveLength(0);
  });
});

describe('DeviceRelayClient streams', () => {
  test('items flow, done ends the iterator', async () => {
    const c = makeClient();
    const streamP = c.client.stream<number>('engine.tail', {});
    await flush();
    c.hub.latest.open();
    await flush();
    const { items } = await streamP;
    rpcReply(c.hub.latest, { id: 1, item: 1 });
    rpcReply(c.hub.latest, { id: 1, item: 2 });
    rpcReply(c.hub.latest, { id: 1, done: true });
    const seen: number[] = [];
    for await (const item of items) seen.push(item);
    expect(seen).toEqual([1, 2]);
  });

  test('an ok frame on a stream is a readiness ack, not a terminator', async () => {
    const c = makeClient();
    const streamP = c.client.stream<number>('engine.tail', {});
    await flush();
    c.hub.latest.open();
    await flush();
    const { items } = await streamP;
    rpcReply(c.hub.latest, { id: 1, ok: {} });
    rpcReply(c.hub.latest, { id: 1, item: 7 });
    rpcReply(c.hub.latest, { id: 1, done: true });
    const seen: number[] = [];
    for await (const item of items) seen.push(item);
    expect(seen).toEqual([7]);
  });

  test('cancel() sends {id, cancel:true} and stops the iterator', async () => {
    const c = makeClient();
    const streamP = c.client.stream<number>('engine.tail', {});
    await flush();
    c.hub.latest.open();
    await flush();
    const { items, cancel } = await streamP;
    const it = items[Symbol.asyncIterator]();
    cancel();
    const last = c.hub.latest.sent[c.hub.latest.sent.length - 1] as Uint8Array;
    const frame = decodeFrame(last);
    expect(new TextDecoder().decode(frame?.payload)).toContain('"cancel":true');
    await expect(it.next()).resolves.toMatchObject({ done: true });
  });
});

describe('DeviceRelayClient liveness', () => {
  test('keepalive sends ping + echo every 10s; host echoes arm the 20s deadline', async () => {
    const c = makeClient();
    const { p, ws } = await dial(c);
    rpcReply(ws, { id: 1, ok: 1 }); // host proof: arms echo enforcement
    await p;
    c.clock.advance(PING_INTERVAL_MS); // tick: ping + echo sent
    expect(ws.sent.some(s => s === 'ping')).toBe(true);
    // Host stays silent. Advance past ECHO_DEADLINE while keeping the
    // transport lease fed with inbound pongs.
    for (let i = 0; i < 4; i++) {
      ws.receive('pong');
      c.clock.advance(PING_INTERVAL_MS);
    }
    // hostOffline teardown closed the socket.
    expect(ws.closed || ws.readyState === 'CLOSED').toBe(true);
  });

  test('without any host echo the echo deadline is NOT enforced', async () => {
    const c = makeClient();
    // Long timeout: the call stays pending while keepalive ticks run.
    const p = c.client.call('engine.ping', {}, { timeoutMs: 300_000 });
    await flush();
    const ws = c.hub.latest;
    ws.open(); // on-open echo goes out, host never echoes back
    await flush();
    // 60s of transport-level pongs but zero host proof: echoSeen stays
    // false so the 20s deadline never applies (old-host compatibility).
    for (let i = 0; i < 6; i++) {
      ws.receive('pong');
      c.clock.advance(PING_INTERVAL_MS);
    }
    expect(ws.closed).toBe(false);
    c.client.close(); // closed clients don't redial — the call settles now
    await expect(p).rejects.toMatchObject({ kind: 'notConnected' });
  });
});
