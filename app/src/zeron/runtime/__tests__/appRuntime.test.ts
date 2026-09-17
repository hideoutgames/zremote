// AppRuntime: registry events → workspaceStore, presence → peerLiveness,
// session controller caching + retain/release, foreground kick, sign-out.

import { AppRuntime } from '../appRuntime';
import { workspaceStore, resetWorkspace } from '../../state/workspaceStore';
import { resetSessionStores } from '../../state/sessionStores';
import { resetCatalog } from '../../state/catalogStore';
import { resetDrafts } from '../../state/draftStore';
import { LoroCrdtAdapter } from '../../doc/loroCrdtAdapter';
import { FakeClock } from '../../transport/clock';
import { staticTokenSource } from '../../transport/tokenSource';
import { FakeWsHub, fakeFetch, type FakeWs } from '../../testing/fakeWs';
import { memDisk, flush, type MemoryFs } from '../../testing/memDisk';
import type { DocDisk } from '../../native/docDisk';
import { encodeHlc, type Row } from '../../protocol/registryCore';

const cfg = { baseUrl: 'https://edge.test' };
const hlc = encodeHlc(1000, 0, 'srv');

const mkRow = (
  kind: string,
  id: string,
  fields: Row['fields'],
  seq = 1,
): Row => ({
  kind,
  id,
  seq,
  deleted: false,
  fields,
  clocks: Object.fromEntries(Object.keys(fields).map(k => [k, hlc])),
});

const stateFrame = (rows: Row[], presence: Record<string, number> = {}) =>
  JSON.stringify({
    t: 'state',
    seq: 3,
    full: true,
    gcFloor: 0,
    rows,
    presence,
  });

const DEVICE_ROW = mkRow('devices', 'host1', {
  id: 'host1',
  name: 'e2e-host',
  platform: 'windows',
  version: '0.2.72',
  capabilities: ['chat2'],
});

const makeRuntime = async (opts: { fs?: MemoryFs; disk?: DocDisk } = {}) => {
  const clock = new FakeClock(1_000_000);
  const hub = new FakeWsHub();
  const { fs, disk } = memDisk();
  const rt = await AppRuntime.create({
    cfg,
    tokenSource: staticTokenSource('u@o1'),
    deviceId: 'phone1',
    deviceName: 'Test Phone',
    orgId: 'o1',
    userId: 'u1',
    wsFactory: hub.factory,
    clock,
    docDisk: opts.disk ?? disk,
    loro: () => new LoroCrdtAdapter(),
    fetchImpl: fakeFetch(() => ({ status: 500 })).fetchImpl,
  });
  return { rt, clock, hub, fs: opts.fs ?? fs };
};

/** Dial → open → answer hello with a state frame. */
const join = async (
  hub: FakeWsHub,
  rows: Row[],
  presence: Record<string, number> = {},
): Promise<FakeWs> => {
  await flush();
  const ws = hub.latest;
  ws.open();
  ws.receive(stateFrame(rows, presence));
  await flush();
  return ws;
};

describe('AppRuntime', () => {
  afterEach(() => {
    resetWorkspace();
    resetSessionStores();
    resetCatalog();
    resetDrafts();
  });

  it('binds a registry state event into workspaceStore', async () => {
    const { rt, hub } = await makeRuntime();
    rt.start();
    await join(hub, [DEVICE_ROW], { host1: 1_000_000 });

    const s = workspaceStore.getState();
    expect(s.connection).toBe('connected');
    expect(s.devices.map(d => d.id)).toEqual(['host1']);
    expect(s.devices[0].version).toBe('0.2.72');
    expect(s.presence.host1).toBe(1_000_000);
    rt.stop();
  });

  it('peerLiveness: live on a fresh beat, dark past 5min, unknown without evidence', async () => {
    const { rt, hub, clock } = await makeRuntime();
    rt.start();
    const ws = await join(hub, [DEVICE_ROW], { host1: clock.now() });

    expect(rt.peerLiveness('host1')).toBe('live');
    // No evidence at all for a never-seen peer (still warming up).
    expect(rt.peerLiveness('ghost')).toBe('unknown');
    clock.advance(46_000);
    ws.receive(
      JSON.stringify({ t: 'presence', device: 'other', at: clock.now() }),
    );
    expect(rt.peerLiveness('host1')).toBe('unknown'); // stale, not yet dark
    // Advance past the 5-minute dark gate while keeping the socket alive
    // (each received frame refreshes the 45s silence lease).
    for (let i = 0; i < 10; i++) {
      clock.advance(30_000);
      ws.receive(
        JSON.stringify({ t: 'presence', device: 'other', at: clock.now() }),
      );
    }
    expect(rt.peerLiveness('host1')).toBe('dark');
    // Past warmup with NO presence and a stale lastSeenAt → dark.
    const { rt: rt2, hub: hub2, clock: clock2 } = await makeRuntime();
    rt2.start();
    const ws2 = await join(hub2, [
      mkRow('devices', 'host2', {
        id: 'host2',
        name: 'old',
        platform: 'macos',
        capabilities: [],
        lastSeenAt: clock2.now() - 10 * 60_000,
      }),
    ]);
    clock2.advance(30_000);
    ws2.receive(
      JSON.stringify({ t: 'presence', device: 'x', at: clock2.now() }),
    );
    clock2.advance(31_000);
    ws2.receive(
      JSON.stringify({ t: 'presence', device: 'x', at: clock2.now() }),
    );
    expect(rt2.peerLiveness('host2')).toBe('dark');
    rt.stop();
    rt2.stop();
  });

  it('openSession caches; retain/release gates closeSession', async () => {
    const { rt, hub } = await makeRuntime();
    rt.start();
    await join(hub, [
      DEVICE_ROW,
      mkRow('chats', 'c1', {
        id: 'c1',
        deviceId: 'host1',
        archived: false,
        createdAt: 1,
        roomGen: 2,
      }),
    ]);

    const c1 = rt.openSession('c1');
    expect(rt.openSession('c1')).toBe(c1);

    // A view holds it: closeSession must NOT close.
    c1.retain();
    rt.closeSession('c1');
    expect(rt.openSession('c1')).toBe(c1);
    expect(c1.isActive).toBe(true);

    // Dropping the last ref stops it; the next open is a fresh controller.
    c1.release();
    expect(c1.isActive).toBe(false);
    const c2 = rt.openSession('c1');
    expect(c2).not.toBe(c1);
    rt.stop();
  });

  it('onForeground kicks the registry and every open session', async () => {
    const { rt, hub } = await makeRuntime();
    rt.start();
    await join(hub, [
      DEVICE_ROW,
      mkRow('chats', 'c1', {
        id: 'c1',
        deviceId: 'host1',
        archived: false,
        createdAt: 1,
        roomGen: 2,
      }),
    ]);
    const c = rt.openSession('c1');
    await flush();
    const kick = jest.spyOn(c, 'kick');
    const regKick = jest.spyOn(rt.registry, 'kick');
    rt.onForeground();
    expect(kick).toHaveBeenCalled();
    expect(regKick).toHaveBeenCalled();
    rt.stop();
  });

  it('clearAccountCaches wipes the account dir and resets all stores', async () => {
    const { fs, disk } = memDisk();
    const { rt, hub } = await makeRuntime({ fs, disk });
    rt.start();
    await join(hub, [DEVICE_ROW], { host1: 1_000_000 });
    expect(workspaceStore.getState().devices.length).toBe(1);

    await rt.clearAccountCaches();
    expect(workspaceStore.getState().devices).toEqual([]);
    expect([...fs.files.keys()].filter(k => k.includes('zeron/o1/u1'))).toEqual(
      [],
    );
  });
});
