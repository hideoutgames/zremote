import type {
  MessageEntry,
  SessionRow,
  SessionStatus,
} from '../../protocol/types';
import {
  bindPendingWorkedDuration,
  bindWorkedDuration,
  freezeWorkedDuration,
  rememberWorkingStart,
  resetWorkedDurations,
  workedDurationStore,
  workedForLabel,
} from '../workedDuration';
import { getSessionStore, resetSessionStores } from '../sessionStores';
import { resetWorkspace, workspaceStore } from '../workspaceStore';

const row = (
  chatId: string,
  status: SessionStatus,
  extra: Partial<SessionRow> = {},
): SessionRow => ({
  chatId,
  deviceId: 'd1',
  status,
  updatedAt: extra.updatedAt ?? 2_000,
  ...extra,
});

const assistant = (
  id: string,
  status: MessageEntry['status'] = 'complete',
): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', id: `${id}-t`, text: 'done' }],
  createdAt: 1,
  deviceId: 'd1',
  status,
});

const user = (id: string): MessageEntry => ({
  id,
  role: 'user',
  parts: [{ kind: 'text', id: `${id}-t`, text: 'go' }],
  createdAt: 1,
  deviceId: 'd1',
  status: 'complete',
});

beforeEach(() => {
  resetWorkedDurations();
  resetSessionStores();
  resetWorkspace();
});

test('remembers start while working and freezes on idle', () => {
  rememberWorkingStart('c1', 1_000);
  expect(freezeWorkedDuration('c1', 1_000 + 38_000)).toEqual({
    startedAt: 1_000,
    endedAt: 1_038_000,
  });
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  bindPendingWorkedDuration('c1');
  expect(workedForLabel('a1')).toBe('38s');
});

test('attaches immediately when the last assistant is already settled', () => {
  getSessionStore('c1').setState({
    entries: [user('u1'), assistant('a1', 'complete')],
  });
  rememberWorkingStart('c1', 5_000);
  freezeWorkedDuration('c1', 5_000 + (14 * 60 + 38) * 1000);
  expect(workedForLabel('a1')).toBe('14m 38s');
  expect(workedDurationStore.getState().pendingByChat.c1).toBeUndefined();
});

test('does not attach to a previous assistant when the last row is the user', () => {
  getSessionStore('c1').setState({
    entries: [assistant('old'), user('u2')],
  });
  rememberWorkingStart('c1', 1_000);
  freezeWorkedDuration('c1', 10_000);
  expect(workedForLabel('old')).toBeUndefined();
  expect(workedDurationStore.getState().pendingByChat.c1).toEqual({
    startedAt: 1_000,
    endedAt: 10_000,
  });
});

test('does not attach while the last assistant is still streaming', () => {
  getSessionStore('c1').setState({
    entries: [assistant('a1', 'streaming')],
  });
  rememberWorkingStart('c1', 1_000);
  freezeWorkedDuration('c1', 4_000);
  expect(workedForLabel('a1')).toBeUndefined();
  getSessionStore('c1').setState({
    entries: [assistant('a1', 'complete')],
  });
  bindPendingWorkedDuration('c1');
  expect(workedForLabel('a1')).toBe('3s');
});

test('attaches to an aborted last assistant', () => {
  getSessionStore('c1').setState({ entries: [assistant('a1', 'aborted')] });
  rememberWorkingStart('c1', 1_000);
  freezeWorkedDuration('c1', 1_000 + 2 * 3_600_000 + 12 * 60_000);
  expect(workedForLabel('a1')).toBe('2h 12m');
});

test('does not overwrite an already-frozen message', () => {
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  rememberWorkingStart('c1', 1_000);
  freezeWorkedDuration('c1', 2_000);
  rememberWorkingStart('c1', 9_000);
  freezeWorkedDuration('c1', 20_000);
  expect(workedForLabel('a1')).toBe('1s');
});

test('freeze is a no-op without a remembered start', () => {
  expect(freezeWorkedDuration('c1', 9_000)).toBeUndefined();
  expect(workedDurationStore.getState().pendingByChat).toEqual({});
});

test('binder remembers startedAt and freezes on working → idle', () => {
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'working', { startedAt: 10_000, updatedAt: 11_000 }),
    },
  });
  const unbind = bindWorkedDuration();
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'idle', {
        updatedAt: 10_000 + 73 * 3_600_000 + 12 * 60_000,
      }),
    },
  });
  expect(workedForLabel('a1')).toBe('73h 12m');
  unbind();
});

test('binder freezes on awaitingInput → idle, not on working → awaitingInput', () => {
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'working', { startedAt: 1_000, updatedAt: 1_100 }),
    },
  });
  const unbind = bindWorkedDuration();
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'awaitingInput', { startedAt: 1_000, updatedAt: 2_000 }),
    },
  });
  expect(workedForLabel('a1')).toBeUndefined();
  workspaceStore.setState({
    sessions: { c1: row('c1', 'idle', { updatedAt: 1_000 + 38_000 }) },
  });
  expect(workedForLabel('a1')).toBe('38s');
  unbind();
});

test('binder first observation of idle is not a finish', () => {
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  workspaceStore.setState({
    sessions: { c1: row('c1', 'idle', { updatedAt: 9_000 }) },
  });
  const unbind = bindWorkedDuration();
  expect(workedForLabel('a1')).toBeUndefined();
  unbind();
});

test('binder does not let updatedAt heartbeats replace startedAt', () => {
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'working', { startedAt: 1_000, updatedAt: 1_100 }),
    },
  });
  const unbind = bindWorkedDuration();
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'working', { startedAt: 1_000, updatedAt: 8_000 }),
    },
  });
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  workspaceStore.setState({
    sessions: {
      c1: row('c1', 'idle', { updatedAt: 1_000 + 14 * 60_000 + 38_000 }),
    },
  });
  expect(workedForLabel('a1')).toBe('14m 38s');
  unbind();
});

test('binder falls back to updatedAt only when startedAt is missing', () => {
  workspaceStore.setState({
    sessions: { c1: row('c1', 'working', { updatedAt: 4_000 }) },
  });
  const unbind = bindWorkedDuration();
  workspaceStore.setState({
    sessions: { c1: row('c1', 'working', { updatedAt: 9_000 }) },
  });
  getSessionStore('c1').setState({ entries: [assistant('a1')] });
  workspaceStore.setState({
    sessions: { c1: row('c1', 'idle', { updatedAt: 4_000 + 38_000 }) },
  });
  expect(workedForLabel('a1')).toBe('38s');
  unbind();
});
