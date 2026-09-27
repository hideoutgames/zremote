import {
  bindWorkspace,
  resetWorkspace,
  workspaceStore,
} from '../workspaceStore';
import type { Chat, SessionRow } from '../../protocol/types';

const chat = (over: Partial<Chat> = {}): Chat => ({
  id: 'c1',
  deviceId: 'h1',
  archived: false,
  createdAt: 1,
  ...over,
});

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  chatId: 'c1',
  deviceId: 'h1',
  status: 'working',
  updatedAt: 10,
  ...over,
});

beforeEach(() => {
  resetWorkspace();
});

test('bindWorkspace skips a publish when nothing the UI reads changed', () => {
  const projection = {
    devices: [],
    spaces: [],
    chats: [chat()],
    sessions: { c1: session() },
  };
  bindWorkspace(projection, { h1: 5 }, 'connected', 1);
  const first = workspaceStore.getState();
  let notifies = 0;
  const unsub = workspaceStore.subscribe(() => {
    notifies += 1;
  });
  bindWorkspace(
    {
      devices: [],
      spaces: [],
      chats: [chat()],
      sessions: { c1: session() },
    },
    { h1: 5 },
    'connected',
    99,
  );
  expect(notifies).toBe(0);
  expect(workspaceStore.getState()).toBe(first);
  expect(first.lastSyncAt).toBe(1);
  unsub();
});

test('a presence beat on the same object still publishes', () => {
  const presence: Record<string, number> = { h1: 5 };
  bindWorkspace(
    { devices: [], spaces: [], chats: [], sessions: {} },
    presence,
    'connected',
    1,
  );
  let seen = 0;
  const unsub = workspaceStore.subscribe(() => {
    seen = workspaceStore.getState().presence.h1;
  });
  presence.h1 = 8;
  bindWorkspace(
    { devices: [], spaces: [], chats: [], sessions: {} },
    presence,
    'connected',
    2,
  );
  expect(seen).toBe(8);
  expect(workspaceStore.getState().presence).not.toBe(presence);
  unsub();
});

test('a session heartbeat keeps chat identity', () => {
  const firstChat = chat();
  bindWorkspace(
    {
      devices: [],
      spaces: [],
      chats: [firstChat],
      sessions: { c1: session({ updatedAt: 10 }) },
    },
    {},
    'connected',
    1,
  );
  bindWorkspace(
    {
      devices: [],
      spaces: [],
      chats: [chat()],
      sessions: { c1: session({ updatedAt: 11 }) },
    },
    {},
    'connected',
    2,
  );
  const next = workspaceStore.getState();
  expect(next.chats[0]).toBe(firstChat);
  expect(next.sessions.c1.updatedAt).toBe(11);
});
