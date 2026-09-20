// SessionController: command queueing, pendingSend adoption/failure,
// runPhase precedence, unsynced-vs-acked, cursor+snapshot persistence —
// all deterministic on FakeClock + FakeWs + a second LoroCrdtAdapter
// playing the host.

import { SessionController } from '../sessionController';
import {
  getSessionStore,
  resetSessionStores,
  runPhase,
} from '../../state/sessionStores';
import { LoroCrdtAdapter } from '../../doc/loroCrdtAdapter';
import { encodeFrame, decodeFrame, FRAME } from '../../protocol/chatFrames';
import { FakeClock } from '../../transport/clock';
import { staticTokenSource } from '../../transport/tokenSource';
import { FakeWsHub, fakeFetch, type FakeWs } from '../../testing/fakeWs';
import { memDisk, flush } from '../../testing/memDisk';
import type { Chat, SessionRow } from '../../protocol/types';
import { PROJECT_COALESCE_MS } from '../../state/projectCoalesce';

const cfg = { baseUrl: 'https://edge.test' };
const DEVICE = 'phone1';

const emptyState = () =>
  encodeFrame(FRAME.state, {
    headSeq: 0,
    seqFloor: 0,
    checkpointSeq: 0,
    checkpointSize: 0,
    rowCount: 0,
    rowBytes: 0,
  });

const makeController = (opts: { roomGen?: number } = {}) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const { fs, disk } = memDisk();
  const host = new LoroCrdtAdapter();
  const phone = new LoroCrdtAdapter();
  const c = new SessionController('c1', {
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: DEVICE,
    orgId: 'o1',
    userId: 'u1',
    wsFactory: hub.factory,
    clock,
    docDisk: disk,
    loro: () => phone,
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
    chatMeta: () => ({
      hostDeviceId: 'host1',
      roomGen: opts.roomGen ?? 2,
    }),
  });
  return { c, clock, hub, disk, fs, host, phone };
};

/** start → room dialed → state → rowsDone ⇒ joined. */
const join = async (x: ReturnType<typeof makeController>): Promise<FakeWs> => {
  await x.c.start();
  await flush();
  const ws = x.hub.latest;
  ws.open();
  ws.receive(emptyState());
  await flush();
  ws.receive(encodeFrame(FRAME.rowsDone, { headSeq: 0 }));
  await flush();
  return ws;
};

/** The batchId of the most recent push frame on the socket. */
const lastPushBatchId = (ws: FakeWs): string => {
  const pushes = ws.sent
    .filter((s): s is Uint8Array => s instanceof Uint8Array)
    .map(decodeFrame)
    .filter(f => f?.type === FRAME.push);
  const last = pushes[pushes.length - 1];
  return last!.header.batchId as string;
};

let hostSeq = 0;
/** Feed the host doc's new updates into the room as a row frame. */
const hostPush = (host: LoroCrdtAdapter, ws: FakeWs): void => {
  host.commit();
  ws.receive(
    encodeFrame(FRAME.row, { seq: ++hostSeq }, host.exportUpdatesFrom(null)),
  );
};

const store = () => getSessionStore('c1').getState();
const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  chatId: 'c1',
  deviceId: 'host1',
  status: 'idle',
  updatedAt: 1_000_000,
  ...over,
});
const chat = (over: Partial<Chat> = {}): Chat => ({
  id: 'c1',
  deviceId: 'host1',
  archived: false,
  createdAt: 1,
  ...over,
});

const phase = (r?: SessionRow, ch?: Chat, now = 1_000_000) =>
  runPhase(store(), r, ch ?? chat(), DEVICE, now);

describe('SessionController', () => {
  beforeEach(() => {
    hostSeq = 0;
    resetSessionStores();
  });

  it('sendRun queues a command, records a pendingSend, pushes it', async () => {
    const x = makeController();
    const ws = await join(x);
    const cmdId = x.c.sendRun('hello', { cwd: '/x' });

    const s = store();
    const pending = s.commands.find(c => c.id === cmdId);
    expect(pending).toBeDefined();
    expect(pending!.status).toBe('pending');
    expect(pending!.issuedBy).toBe(DEVICE);
    expect(s.pendingSends).toHaveLength(1);
    expect(s.unsyncedCommandIds).toContain(cmdId);
    expect(lastPushBatchId(ws)).toBeTruthy();
    x.c.stop();
  });

  it('pushAcked flips queuedLocally → synchronized', async () => {
    const x = makeController();
    const ws = await join(x);
    x.c.sendRun('hi', {});
    expect(phase()).toBe('queuedLocally');

    const batchId = lastPushBatchId(ws);
    ws.receive(encodeFrame(FRAME.ack, { batchId, seq: 1 }));
    await flush();
    expect(store().unsyncedCommandIds).toEqual([]);
    expect(phase()).toBe('synchronized');
    x.c.stop();
  });

  it('a host entry with the run messageId adopts (drops) the pendingSend', async () => {
    const x = makeController();
    const ws = await join(x);
    x.c.sendRun('hi', {});
    const msgId = store().pendingSends[0].messageId;

    // Host imports our push, then writes the user entry with that id.
    const pushes = ws.sent
      .filter((s): s is Uint8Array => s instanceof Uint8Array)
      .map(decodeFrame)
      .filter(f => f?.type === FRAME.push);
    for (const p of pushes) x.host.import(p!.payload);
    x.host.pushMapToList('messages', {
      id: msgId,
      role: 'user',
      createdAt: 1_000_001,
      deviceId: 'host1',
    });
    hostPush(x.host, ws);
    await flush();

    expect(store().pendingSends).toHaveLength(0);
    expect(store().entries.map(e => e.id)).toContain(msgId);
    x.c.stop();
  });

  it('a terminally-rejected command moves the send to failedSends', async () => {
    const x = makeController();
    const ws = await join(x);
    const cmdId = x.c.sendRun('hi', {});

    const pushes = ws.sent
      .filter((s): s is Uint8Array => s instanceof Uint8Array)
      .map(decodeFrame)
      .filter(f => f?.type === FRAME.push);
    for (const p of pushes) x.host.import(p!.payload);
    x.host.setListMapField('commands', 0, 'status', 'rejected');
    hostPush(x.host, ws);
    await flush();

    const s = store();
    expect(s.pendingSends).toHaveLength(0);
    expect(s.failedSends).toHaveLength(1);
    expect(s.failedSends[0].commandId).toBe(cmdId);
    expect(s.failedSends[0].status).toBe('rejected');
    x.c.stop();
  });

  it('interrupt → stopping until applied AND the row leaves working', async () => {
    const x = makeController();
    const ws = await join(x);
    x.c.sendRun('long', {});
    const workingRow = row({ status: 'working' });
    x.c.interrupt();

    expect(phase(workingRow)).toBe('stopping');

    // Host applies the interrupt; row still working → still not idle.
    const pushes = ws.sent
      .filter((s): s is Uint8Array => s instanceof Uint8Array)
      .map(decodeFrame)
      .filter(f => f?.type === FRAME.push);
    for (const p of pushes) x.host.import(p.payload);
    const cmds = (x.host.toJSON() as { commands: unknown[] }).commands;
    for (let i = 0; i < cmds.length; i++)
      x.host.setListMapField('commands', i, 'status', 'applied');
    hostPush(x.host, ws);
    await flush();
    expect(phase(workingRow)).toBe('working');
    expect(phase(row({ status: 'idle' }))).toBe('idle');
    x.c.stop();
  });

  it('an unresolved input part yields awaitingInput', async () => {
    const x = makeController();
    const ws = await join(x);
    // Host writes an assistant entry carrying an input part.
    x.host.pushMapToList('messages', {
      id: 'e1',
      role: 'assistant',
      createdAt: 1,
      deviceId: 'host1',
      parts: [
        {
          kind: 'input',
          id: 'p1',
          requestId: 'r1',
          resolved: false,
          questions: [
            {
              id: 'q1',
              header: 'h',
              question: 'ok?',
              options: ['a', 'b'],
            },
          ],
        },
      ],
    });
    hostPush(x.host, ws);
    await flush();
    expect(phase()).toBe('awaitingInput');
    x.c.stop();
  });

  it('stale: working row older than 45s with no streaming entry', async () => {
    const x = makeController();
    await join(x);
    const staleRow = row({ status: 'working', updatedAt: 1_000_000 });
    expect(phase(staleRow, undefined, 1_000_000 + 46_000)).toBe('stale');
    expect(phase(staleRow, undefined, 1_000_000 + 44_000)).toBe('working');
    x.c.stop();
  });

  it('persists snapshot+cursor in ONE write and rehydrates', async () => {
    const x = makeController();
    const ws = await join(x);
    x.c.sendRun('hi', {});
    ws.receive(
      encodeFrame(FRAME.ack, { batchId: lastPushBatchId(ws), seq: 1 }),
    );
    await flush();
    await x.c.flush();

    const files = x.fs.writes.filter(f => f.includes('c1.chat2'));
    expect(files.length).toBeGreaterThan(0);
    const saved = await x.disk.loadChat2('o1', 'u1', 'c1');
    expect(saved).toBeDefined();
    expect(saved!.cursor).toBe(1);

    // A fresh controller over the same disk rehydrates entries/commands.
    const x2 = makeController();
    x2.c.stop();
    const c2 = new SessionController('c1', {
      cfg,
      tokenSource: staticTokenSource('u@o1'),
      deviceId: DEVICE,
      orgId: 'o1',
      userId: 'u1',
      wsFactory: x2.hub.factory,
      clock: x2.clock,
      docDisk: x.disk,
      loro: () => new LoroCrdtAdapter(),
      fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
      chatMeta: () => ({ hostDeviceId: 'host1', roomGen: 2 }),
    });
    await c2.start();
    await flush();
    expect(getSessionStore('c1').getState().commands.length).toBeGreaterThan(0);
    c2.stop();
    x.c.stop();
  });

  it('does not dial a room when roomGen < 2', async () => {
    const x = makeController({ roomGen: 1 });
    await x.c.start();
    await flush();
    expect(x.hub.sockets).toHaveLength(0);
    x.c.stop();
  });

  it('overlapping start() waits for subscribe; sendRun after that is pushed', async () => {
    const x = makeController();
    let release!: () => void;
    const gate = new Promise<void>(r => {
      release = r;
    });
    const orig = x.disk.loadChat2.bind(x.disk);
    jest
      .spyOn(x.disk, 'loadChat2')
      .mockImplementation(async (org, user, id) => {
        await gate;
        return orig(org, user, id);
      });

    const first = x.c.start();
    let secondSettled = false;
    const second = x.c.start().then(() => {
      secondSettled = true;
    });
    await flush();
    expect(secondSettled).toBe(false);
    expect(x.hub.sockets).toHaveLength(0);

    release();
    await first;
    await second;
    expect(secondSettled).toBe(true);

    await flush();
    const ws = x.hub.latest;
    ws.open();
    ws.receive(emptyState());
    await flush();
    ws.receive(encodeFrame(FRAME.rowsDone, { headSeq: 0 }));
    await flush();

    const cmdId = x.c.sendRun('hello', { cwd: '/x' });
    expect(cmdId).toBeTruthy();
    expect(lastPushBatchId(ws)).toBeTruthy();
    x.c.stop();
  });

  it('sendRun projects once (basedOn reads the store, not a second toJSON)', async () => {
    const x = makeController();
    const orig = x.phone.toJSON.bind(x.phone);
    let jsonCount = 0;
    x.phone.toJSON = () => {
      jsonCount += 1;
      return orig();
    };
    const ws = await join(x);
    jsonCount = 0;
    x.c.sendRun('hello', {});
    expect(jsonCount).toBe(1);
    expect(lastPushBatchId(ws)).toBeTruthy();
    x.c.stop();
  });

  it('basedOnTurnId is the last projected entry id', async () => {
    const x = makeController();
    const ws = await join(x);
    x.host.pushMapToList('messages', {
      id: 'turn-1',
      role: 'user',
      createdAt: 1,
      deviceId: 'host1',
    });
    hostPush(x.host, ws);
    await flush();
    expect(store().entries.map(e => e.id)).toContain('turn-1');
    x.c.sendRun('next', {});
    const run = store().commands.find(c => c.kind === 'run');
    expect(run?.basedOn?.turnId).toBe('turn-1');
    x.c.stop();
  });

  it('same-tick applyRows share one toJSON and one store write', async () => {
    const x = makeController();
    const ws = await join(x);
    const port = x.phone;
    const orig = port.toJSON.bind(port);
    let jsonCount = 0;
    port.toJSON = () => {
      jsonCount += 1;
      return orig();
    };
    let writes = 0;
    const unsub = getSessionStore('c1').subscribe(() => {
      writes += 1;
    });
    jsonCount = 0;
    writes = 0;
    for (const id of ['a', 'b', 'c']) {
      x.host.pushMapToList('messages', {
        id,
        role: 'user',
        createdAt: 1,
        deviceId: 'host1',
      });
      hostPush(x.host, ws);
    }
    expect(jsonCount).toBe(0);
    expect(store().entries).toHaveLength(0);
    await flush();
    expect(jsonCount).toBe(1);
    expect(writes).toBe(1);
    expect(store().entries.map(e => e.id)).toEqual(['a', 'b', 'c']);
    unsub();
    x.c.stop();
  });

  it('a later row inside the coalesce window does not project until the timer', async () => {
    const x = makeController();
    const ws = await join(x);
    x.host.pushMapToList('messages', {
      id: 'a',
      role: 'user',
      createdAt: 1,
      deviceId: 'host1',
    });
    hostPush(x.host, ws);
    await flush();
    expect(store().entries.map(e => e.id)).toEqual(['a']);
    x.host.pushMapToList('messages', {
      id: 'b',
      role: 'user',
      createdAt: 2,
      deviceId: 'host1',
    });
    hostPush(x.host, ws);
    await flush();
    expect(store().entries.map(e => e.id)).toEqual(['a']);
    x.clock.advance(PROJECT_COALESCE_MS);
    expect(store().entries.map(e => e.id)).toEqual(['a', 'b']);
    x.c.stop();
  });
});
