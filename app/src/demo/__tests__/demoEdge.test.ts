// DemoEdge end-to-end: boots a real AppRuntime (registry client, device
// relay, RelaySessionSource) against the in-process simulated edge — no
// network, deterministic FakeClock.

import { AppRuntime } from '../../zeron/runtime/appRuntime';
import { renameChat } from '../../zeron/runtime/workspaceActions';
import {
  resetWorkspace,
  workspaceStore,
} from '../../zeron/state/workspaceStore';
import {
  getSessionStore,
  resetSessionStores,
} from '../../zeron/state/sessionStores';
import { FakeClock } from '../../zeron/transport/clock';
import { staticTokenSource } from '../../zeron/transport/tokenSource';
import { flush, memDisk } from '../../zeron/testing/memDisk';
import { DemoEdge } from '../demoEdge';
import {
  CHAT_INPUT,
  CHAT_ERRORED,
  CHAT_LONG,
  CHAT_WORKING,
  DEMO_ORG,
  DEMO_PHONE,
  DEMO_USER,
  HOST_DARK,
  HOST_LIVE,
} from '../fixtures';

const CHAT = { cwd: '/demo/code/zeron' };

const makeRuntime = async () => {
  const clock = new FakeClock(1_800_000_000_000);
  const edge = new DemoEdge({ clock });
  const { disk } = memDisk();
  const rt = await AppRuntime.create({
    cfg: { baseUrl: 'https://demo.invalid' },
    tokenSource: staticTokenSource('demo'),
    deviceId: DEMO_PHONE,
    deviceName: 'Demo Phone',
    orgId: DEMO_ORG,
    userId: DEMO_USER,
    wsFactory: edge.wsFactory,
    fetchImpl: edge.fetchImpl,
    clock,
    docDisk: disk,
    loro: () => {
      throw new Error('demo: no loro');
    },
    sessionMode: 'relay',
  });
  return { rt, clock };
};

afterEach(() => {
  resetWorkspace();
  resetSessionStores();
});

test('registry state projects into workspaceStore; presence drives liveness', async () => {
  const { rt, clock } = await makeRuntime();
  rt.start();
  await flush();

  const ws = workspaceStore.getState();
  expect(ws.devices).toHaveLength(2);
  expect(ws.spaces).toHaveLength(3);
  expect(ws.chats).toHaveLength(7);
  expect(ws.sessions[CHAT_WORKING]?.status).toBe('working');
  expect(ws.sessions[CHAT_INPUT]?.status).toBe('awaitingInput');
  expect(ws.sessions[CHAT_ERRORED]?.status).toBe('errored');
  expect(rt.peerLiveness(HOST_LIVE)).toBe('live');

  // The dark host proves itself after the dial-gate warm-up: lastSeen is 3h
  // stale, past the 5-min dark threshold.
  clock.advance(61_000);
  await flush();
  expect(rt.peerLiveness(HOST_DARK)).toBe('dark');
  rt.stop();
});

test('opening the working chat catches up then streams to complete', async () => {
  const { rt, clock } = await makeRuntime();
  rt.start();
  await flush();

  const controller = rt.openSession(CHAT_WORKING);
  await flush();
  const store = getSessionStore(CHAT_WORKING);
  expect(store.getState().room).toBe('caughtUp');
  expect(store.getState().entries.length).toBeGreaterThan(0);

  // resumeWorking finishes the in-flight assistant entry.
  clock.advance(3_000);
  await flush();
  const tail = store.getState().entries.at(-1);
  expect(tail?.status).toBe('complete');
  expect(workspaceStore.getState().sessions[CHAT_WORKING]?.status).toBe('idle');
  controller.release();
  rt.closeSession(CHAT_WORKING);
  rt.stop();
});

test('sendRun streams an assistant reply; pendingSends reconciles', async () => {
  const { rt, clock } = await makeRuntime();
  rt.start();
  await flush();
  const controller = rt.openSession(CHAT_LONG);
  await flush();
  const store = getSessionStore(CHAT_LONG);
  const before = store.getState().entries.length;

  controller.sendRun('hello', CHAT);
  await flush();
  clock.advance(700);
  await flush();
  // User entry landed with the host-minted message id.
  expect(store.getState().entries.length).toBeGreaterThan(before);
  expect(store.getState().pendingSends).toEqual([]);

  clock.advance(6_000);
  await flush();
  const entries = store.getState().entries;
  const assistant = entries.at(-1);
  expect(assistant?.role).toBe('assistant');
  expect(assistant?.status).toBe('complete');
  const kinds = assistant?.parts.map(p => p.kind) ?? [];
  expect(kinds).toContain('reasoning');
  expect(kinds).toContain('tool');
  expect(store.getState().meta.contextUsage?.tokens).toBe(41_000);
  expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe('idle');
  controller.release();
  rt.closeSession(CHAT_LONG);
  rt.stop();
});

test('interrupt mid-stream aborts the entry and idles the row', async () => {
  const { rt, clock } = await makeRuntime();
  rt.start();
  await flush();
  const controller = rt.openSession(CHAT_LONG);
  await flush();
  const store = getSessionStore(CHAT_LONG);

  controller.sendRun('count to ten', CHAT);
  await flush();
  clock.advance(1_800); // mid-stream
  await flush();
  expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe('working');

  controller.interrupt();
  await flush();
  const tail = store.getState().entries.at(-1);
  expect(tail?.status).toBe('aborted');
  expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe('idle');
  controller.release();
  rt.closeSession(CHAT_LONG);
  rt.stop();
});

test('every third run ends in an input request; respondInput finishes it', async () => {
  const { rt, clock } = await makeRuntime();
  rt.start();
  await flush();
  const controller = rt.openSession(CHAT_LONG);
  await flush();
  const store = getSessionStore(CHAT_LONG);

  for (let i = 0; i < 2; i += 1) {
    controller.sendRun(`run ${i}`, CHAT);
    await flush();
    clock.advance(6_000);
    await flush();
    expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe('idle');
  }

  controller.sendRun('third', CHAT);
  await flush();
  clock.advance(6_000);
  await flush();
  expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe(
    'awaitingInput',
  );
  const tail = store.getState().entries.at(-1);
  const input = tail?.parts.find(p => p.kind === 'input');
  if (input === undefined || input.kind !== 'input')
    throw new Error('expected an input part');
  expect(input.resolved).toBe(false);
  expect(input.questions[0].options).toHaveLength(3);

  controller.respondInput(input.requestId, [
    { questionId: 'q1', labels: ['Minimal patch'] },
  ]);
  await flush();
  clock.advance(1_000);
  await flush();
  const resolved = store
    .getState()
    .entries.at(-1)
    ?.parts.find(p => p.kind === 'input' && p.id === input.id);
  expect(resolved?.kind === 'input' && resolved.resolved).toBe(true);
  expect(store.getState().entries.at(-1)?.status).toBe('complete');
  expect(workspaceStore.getState().sessions[CHAT_LONG]?.status).toBe('idle');
  controller.release();
  rt.closeSession(CHAT_LONG);
  rt.stop();
});

test('registry write round-trip: rename pushes, acks, and reflects', async () => {
  const { rt } = await makeRuntime();
  rt.start();
  await flush();

  renameChat(rt, CHAT_LONG, 'Renamed in demo');
  rt.registry.flushPending();
  await flush();

  const chat = workspaceStore.getState().chats.find(c => c.id === CHAT_LONG);
  expect(chat?.title).toBe('Renamed in demo');
  expect(rt.registryDoc.pendingCount).toBe(0);
  rt.stop();
});
