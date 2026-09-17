// chatRoomClient: hello → state → planCatchUp branches, checkpoint fetch
// (mocked fetchImpl), rows/rowsDone/live, ack + dup ack, reconnect re-push,
// error frames, cursor clamp, row-gap repair — deterministic on FakeClock.

import {
  ChatRoomClient,
  type ChatRoomDelegate,
  type ChatRoomEvent,
} from '../chatRoomClient';
import { decodeFrame, encodeFrame, FRAME } from '../../protocol/chatFrames';
import { FakeClock } from '../clock';
import { staticTokenSource } from '../tokenSource';
import type { FetchImpl } from '../edgeHttp';
import { FakeWs, FakeWsHub, fakeFetch } from '../../testing/fakeWs';

const cfg = { baseUrl: 'https://edge.test' };

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

class FakeDelegate implements ChatRoomDelegate {
  cursorVal = 0;
  contained = true;
  checkpoints: { bytes: Uint8Array; seq: number }[] = [];
  rows: { bytes: Uint8Array; seq: number }[] = [];
  events: ChatRoomEvent[] = [];
  failCheckpoint = false;

  cursor(): number {
    return this.cursorVal;
  }
  containsFrontier(): boolean {
    return this.contained;
  }
  applyCheckpoint(bytes: Uint8Array, seq: number): boolean {
    if (this.failCheckpoint) return false;
    this.checkpoints.push({ bytes, seq });
    if (seq > this.cursorVal) this.cursorVal = seq;
    return true;
  }
  applyRow(bytes: Uint8Array, seq: number): void {
    this.rows.push({ bytes, seq });
    if (seq > this.cursorVal) this.cursorVal = seq;
  }
  advanceCursor(seq: number): void {
    if (seq > this.cursorVal) this.cursorVal = seq;
  }
  clampCursor(seq: number): void {
    if (this.cursorVal > seq) this.cursorVal = seq;
  }
  setCursor(seq: number): void {
    this.cursorVal = seq;
  }
  onEvent(e: ChatRoomEvent): void {
    this.events.push(e);
  }
}

const stateFrame = (h: Record<string, unknown>, payload = new Uint8Array(0)) =>
  encodeFrame(FRAME.state, h, payload);

const emptyState = (over: Record<string, unknown> = {}) =>
  stateFrame({
    headSeq: 5,
    seqFloor: 0,
    checkpointSeq: 0,
    checkpointSize: 0,
    rowCount: 0,
    rowBytes: 0,
    ...over,
  });

const sentFrames = (ws: FakeWs) =>
  ws.sent
    .filter((s): s is Uint8Array => s instanceof Uint8Array)
    .map(b => decodeFrame(b));

const makeClient = (
  opts: { delegate?: FakeDelegate; fetchImpl?: FetchImpl } = {},
) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const delegate = opts.delegate ?? new FakeDelegate();
  const client = new ChatRoomClient({
    cfg,
    chatId: 'chat1',
    deviceId: 'd1',
    wsFactory: hub.factory,
    tokenSource: staticTokenSource('u@o1'),
    clock,
    delegate,
    fetchImpl: opts.fetchImpl ?? fakeFetch(() => ({ status: 500 })).fetchImpl, // pulls no-op
  });
  return { client, clock, hub, delegate };
};

/** Dial → open → hello answered by `state` → rowsDone → joined. */
const join = async (c: ReturnType<typeof makeClient>, state = emptyState()) => {
  c.client.start();
  await flush();
  const ws = c.hub.latest;
  ws.open();
  ws.receive(state);
  await flush();
  ws.receive(encodeFrame(FRAME.rowsDone, { headSeq: 5 }));
  return ws;
};

describe('ChatRoomClient catch-up', () => {
  test('rowsOnly: hello with cursor → state → rowsReq(after=cursor) → rows → rowsDone → caughtUp', async () => {
    const c = makeClient();
    const ws = await join(c);
    const hello = sentFrames(ws).find(f => f?.type === FRAME.hello);
    expect(hello?.header).toMatchObject({ cursor: 0, device: 'd1' });
    const rowsReq = sentFrames(ws).find(f => f?.type === FRAME.rowsReq);
    expect(rowsReq?.header).toMatchObject({ after: 0, excludeOwn: false });
    // A live row contiguous with the cursor applies at its own seq.
    ws.receive(
      encodeFrame(
        FRAME.row,
        { seq: 1, device: 'h1', batchId: 'b' },
        new Uint8Array([9]),
      ),
    );
    ws.receive(encodeFrame(FRAME.rowsDone, { headSeq: 5 }));
    expect(c.delegate.rows).toHaveLength(1);
    expect(c.delegate.rows[0].seq).toBe(1);
    expect(c.delegate.cursorVal).toBe(1);
    const types = c.delegate.events.map(e => e.t);
    expect(types).toContain('caughtUp');
    expect(types).toContain('connected');
    expect(c.client.isJoined).toBe(true);
  });

  test('cursor amnesty: first state clamps a cursor above the checkpoint seq', async () => {
    const delegate = new FakeDelegate();
    delegate.cursorVal = 5; // claims rows ≤5 held
    const c = makeClient({ delegate });
    // checkpointSize 0 ⇒ amnesty clamps to 0 (checkpoint-less rooms → zero).
    const ws = await join(c, emptyState({ headSeq: 10 }));
    expect(delegate.cursorVal).toBe(0);
    const rowsReq = sentFrames(ws).find(f => f?.type === FRAME.rowsReq);
    expect(rowsReq?.header).toMatchObject({ after: 0 });
  });

  test('checkpointThenRows: frontier NOT contained → GET checkpoint, buffered rows replay after import', async () => {
    const delegate = new FakeDelegate();
    delegate.contained = false;
    const cpBytes = new Uint8Array([1, 2, 3]);
    let resolveCp: (() => void) | undefined;
    const cpReady = new Promise<void>(r => {
      resolveCp = r;
    });
    const { fetchImpl, calls } = fakeFetch(async url => {
      if (url.includes('/checkpoint')) {
        await cpReady;
        return {
          status: 200,
          headers: {
            get: (n: string) => (n === 'x-chat2-checkpoint-seq' ? '10' : null),
          },
          arrayBuffer: async () => cpBytes.buffer as ArrayBuffer,
        };
      }
      return { status: 500 }; // the HTTPS row pull stays quiet in this test
    });
    const c = makeClient({ delegate, fetchImpl });
    c.client.start();
    await flush();
    const ws = c.hub.latest;
    ws.open();
    ws.receive(
      stateFrame(
        {
          headSeq: 12,
          seqFloor: 0,
          checkpointSeq: 10,
          checkpointSize: 100,
          rowCount: 0,
          rowBytes: 0,
        },
        new Uint8Array([0xaa]), // frontier bytes — NOT contained
      ),
    );
    await flush();
    // rowsReq went out for rows after the checkpoint seq.
    expect(
      sentFrames(ws).find(f => f?.type === FRAME.rowsReq)?.header,
    ).toMatchObject({
      after: 10,
    });
    // A live row landing mid-download must buffer, not apply before import.
    ws.receive(encodeFrame(FRAME.row, { seq: 11 }, new Uint8Array([7])));
    expect(delegate.rows).toHaveLength(0);
    resolveCp?.();
    await flush();
    expect(delegate.checkpoints).toHaveLength(1);
    expect(delegate.checkpoints[0].seq).toBe(10);
    expect(delegate.rows[0]?.seq).toBe(11);
    expect(
      calls.some(call => call.url.includes('/chat2/chat1/checkpoint')),
    ).toBe(true);
  });

  test('frontier contained → rowsOnly after max(cursor, checkpointSeq), no fetch', async () => {
    const delegate = new FakeDelegate();
    delegate.contained = true;
    const { fetchImpl, calls } = fakeFetch(() => ({ status: 500 }));
    const c = makeClient({ delegate, fetchImpl });
    c.client.start();
    await flush();
    const ws = c.hub.latest;
    ws.open();
    ws.receive(
      stateFrame({
        headSeq: 20,
        seqFloor: 0,
        checkpointSeq: 8,
        checkpointSize: 50,
        rowCount: 0,
        rowBytes: 0,
      }),
    );
    await flush();
    // Amnesty clamps cursor 0 → no clamp; plan: rowsOnly after max(0,8)=8.
    expect(
      sentFrames(ws).find(f => f?.type === FRAME.rowsReq)?.header,
    ).toMatchObject({
      after: 8,
    });
    expect(calls.every(call => !call.url.includes('/checkpoint'))).toBe(true);
  });
});

describe('ChatRoomClient push/ack', () => {
  test('enqueue → push frame; ack retires the batch and emits pushAcked', async () => {
    const c = makeClient();
    const ws = await join(c);
    c.client.enqueue(new Uint8Array([1, 2]));
    const pushes = sentFrames(ws).filter(f => f?.type === FRAME.push);
    expect(pushes).toHaveLength(1);
    const batchId = pushes[0]?.header.batchId as string;
    ws.receive(encodeFrame(FRAME.ack, { batchId, seq: 6, dup: false }));
    expect(c.delegate.events).toContainEqual({
      t: 'pushAcked',
      batchId,
      seq: 6,
    });
    // A duplicate ack is a no-op.
    ws.receive(encodeFrame(FRAME.ack, { batchId, seq: 6, dup: true }));
    expect(c.delegate.events.filter(e => e.t === 'pushAcked')).toHaveLength(1);
  });

  test('unacked batches re-push after a reconnect (batchId dedupe)', async () => {
    const c = makeClient();
    const ws1 = await join(c);
    c.client.enqueue(new Uint8Array([5]));
    const batchId = sentFrames(ws1).find(f => f?.type === FRAME.push)?.header
      .batchId;
    ws1.drop();
    c.clock.advance(300); // backoff 250ms
    await flush();
    const ws2 = c.hub.latest;
    expect(ws2).not.toBe(ws1);
    ws2.open();
    ws2.receive(emptyState());
    await flush();
    const repush = sentFrames(ws2).find(f => f?.type === FRAME.push);
    expect(repush?.header.batchId).toBe(batchId); // same batch id — server dedupes
  });

  test('error frame (bad_push) retires the batch and keeps the socket', async () => {
    const c = makeClient();
    const ws = await join(c);
    c.client.enqueue(new Uint8Array([3]));
    const batchId = sentFrames(ws).find(f => f?.type === FRAME.push)?.header
      .batchId as string;
    ws.receive(
      encodeFrame(FRAME.error, { code: 'bad_push', message: 'nope', batchId }),
    );
    expect(c.delegate.events).toContainEqual(
      expect.objectContaining({ t: 'error', code: 'bad_push' }),
    );
    expect(c.delegate.events.map(e => e.t)).not.toContain('disconnected');
    // Reconnect: the rejected batch does NOT come back.
    ws.drop();
    c.clock.advance(300);
    await flush();
    const ws2 = c.hub.latest;
    ws2.open();
    ws2.receive(emptyState());
    await flush();
    expect(sentFrames(ws2).some(f => f?.type === FRAME.push)).toBe(false);
  });
});

describe('ChatRoomClient integrity', () => {
  test('a row gap holds the honest cursor and triggers a backfill repair', async () => {
    const c = makeClient();
    const ws = await join(c);
    ws.receive(encodeFrame(FRAME.rowsDone, { headSeq: 5 }));
    const before = sentFrames(ws).filter(f => f?.type === FRAME.rowsReq).length;
    // Row seq 3 while the cursor is 0 → gap; apply at the honest cursor.
    ws.receive(encodeFrame(FRAME.row, { seq: 3 }, new Uint8Array([1])));
    expect(c.delegate.rows[c.delegate.rows.length - 1].seq).toBe(0);
    const repairs = sentFrames(ws).filter(
      f => f?.type === FRAME.rowsReq && f.header.excludeOwn === false,
    );
    expect(repairs.length).toBeGreaterThan(before);
    expect(repairs[repairs.length - 1]?.header.after).toBe(0);
  });

  test('unparseable frame redials', async () => {
    const c = makeClient();
    const ws = await join(c);
    ws.receive(new Uint8Array([0xff, 0xff]));
    expect(c.delegate.events.map(e => e.t)).toContain('disconnected');
    c.clock.advance(300);
    await flush();
    expect(c.hub.sockets.length).toBe(2);
  });
});
