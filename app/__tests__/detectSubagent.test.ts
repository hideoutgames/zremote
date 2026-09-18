import {
  collectThreadSubagents,
  humanizeAgentName,
  isSubagentSpawn,
  subagentView,
} from '../src/components/transcript/detectSubagent';
import type { MessageEntry, MessagePart } from '../src/zeron/protocol/types';

const assistant = (
  parts: MessageEntry['parts'],
  status: MessageEntry['status'] = 'complete',
): MessageEntry => ({
  id: 'a1',
  role: 'assistant',
  parts,
  createdAt: 1,
  deviceId: 'd1',
  status,
});

const spawn = (
  id: string,
  name: string,
  extra: Partial<Extract<MessagePart, { kind: 'tool' }>> & {
    input?: Record<string, unknown>;
    subagentStatus?: 'running' | 'done' | 'failed';
    resolved?: boolean;
    isError?: boolean;
  } = {},
): Extract<MessagePart, { kind: 'tool' }> => {
  const { input, subagentStatus, resolved, isError, ...rest } = extra;
  return {
    kind: 'tool',
    id,
    call: {
      kind: 'unknown',
      name,
      ...(input !== undefined ? { input } : {}),
    },
    resolved: resolved ?? true,
    ...(isError !== undefined ? { isError } : {}),
    ...(subagentStatus !== undefined ? { subagentStatus } : {}),
    ...rest,
  };
};

test('isSubagentSpawn detects Agent names and status fields', () => {
  expect(isSubagentSpawn(spawn('s1', 'Agent: Explore composer UI'))).toBe(true);
  expect(isSubagentSpawn(spawn('s2', 'Agent'))).toBe(true);
  expect(
    isSubagentSpawn({
      kind: 'tool',
      id: 's3',
      call: { kind: 'search', pattern: 'x' },
      resolved: true,
      subagentStatus: 'done',
    }),
  ).toBe(true);
  expect(
    isSubagentSpawn({
      kind: 'tool',
      id: 's4',
      call: { kind: 'readFile', path: '/a.ts' },
      resolved: true,
    }),
  ).toBe(false);
  expect(isSubagentSpawn({ kind: 'text', id: 't', text: 'hi' })).toBe(false);
});

test('subagentView reads title, type, and status', () => {
  const view = subagentView(
    spawn('t-sub', 'Agent: Explore composer UI', {
      input: { subagent_type: 'Explore' },
      subagentStatus: 'done',
    }),
  );
  expect(view).toEqual({
    id: 't-sub',
    title: 'Explore composer UI',
    agentName: 'Explorer',
    state: 'done',
  });
});

test('subagentView falls back title and infers state', () => {
  expect(subagentView(spawn('a', 'Agent')).title).toBe('Subagent');
  expect(
    subagentView(spawn('b', 'Agent: Trace', { resolved: false })).state,
  ).toBe('running');
  expect(
    subagentView(spawn('c', 'Agent: Trace', { isError: true })).state,
  ).toBe('failed');
  expect(
    subagentView(
      spawn('d', 'Agent: Trace', {
        resolved: true,
        subagentStatus: 'running',
      }),
    ).state,
  ).toBe('running');
});

test('humanizeAgentName maps known types', () => {
  expect(humanizeAgentName('Explore')).toBe('Explorer');
  expect(humanizeAgentName('general-purpose')).toBe('General');
  expect(humanizeAgentName('generalPurpose')).toBe('General');
  expect(humanizeAgentName('Bugfinder')).toBe('Bugfinder');
});

test('collectThreadSubagents puts currently working first', () => {
  const entries = [
    assistant([
      spawn('done', 'Agent: Explore composer UI', {
        input: { subagent_type: 'Explore' },
        subagentStatus: 'done',
      }),
      {
        kind: 'tool',
        id: 'read',
        call: { kind: 'readFile', path: '/a.ts' },
        resolved: true,
      },
      spawn('run', 'Agent: Trace header styles', {
        input: { subagent_type: 'Explore' },
        subagentStatus: 'running',
        resolved: false,
      }),
      spawn('fail', 'Agent: Broken lookup', {
        subagentStatus: 'failed',
      }),
    ]),
  ];
  const list = collectThreadSubagents(entries);
  expect(list.map(v => v.id)).toEqual(['run', 'done', 'fail']);
  expect(list[0]).toMatchObject({
    title: 'Trace header styles',
    agentName: 'Explorer',
    state: 'running',
  });
});
