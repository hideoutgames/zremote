import { bindLocalLogs } from '../bindLocalLogs';
import {
  currentLocalLogWriter,
  deleteLocalLogs,
  fileStamp,
  formatLogStamp,
  installLocalLogWriter,
  parseLogFileAt,
  routeRuntimeLog,
} from '../localLogs';
import { memLocalLogFs } from '../../testing/memLocalLogFs';
import { flush } from '../../testing/memDisk';
import { resetSessionStores, getSessionStore } from '../../state/sessionStores';
import { resetWorkspace, workspaceStore } from '../../state/workspaceStore';
import { uiPrefsStore } from '../../state/uiPrefs';
import type {
  Chat,
  MessageEntry,
  SessionCommandEntry,
  SessionRow,
} from '../../protocol/types';

const NOW = Date.parse('2026-09-21T18:17:03.102Z');
const PROMPT = 'please refactor the parser carefully';
const TOOL_PATH = '/Users/ada/project/file.ts';

const chat = (): Chat => ({
  id: 'c1',
  deviceId: 'host1',
  archived: false,
  createdAt: 1,
  title: 'Demo thread',
  roomGen: 2,
});

const row = (status: SessionRow['status'], updatedAt = NOW): SessionRow => ({
  chatId: 'c1',
  deviceId: 'host1',
  status,
  updatedAt,
  startedAt: NOW,
});

const runCommand = (): SessionCommandEntry => ({
  id: 'cmd1',
  kind: 'run',
  payload: {
    kind: 'run',
    messageId: 'm1',
    request: {
      prompt: PROMPT,
      modelOptions: {},
      cwd: '/Users/ada/project',
      sandbox: 'workspace-write',
      autoApprove: false,
    },
  },
  issuedBy: 'phone',
  issuedAt: NOW,
  status: 'pending',
});

const entry = (parts: MessageEntry['parts']): MessageEntry => ({
  id: 'e1',
  role: 'assistant',
  parts,
  createdAt: NOW,
  deviceId: 'host1',
});

const bodies = (fs: ReturnType<typeof memLocalLogFs>): string =>
  [...fs.files.values()].join('\n');

let unbind: (() => void) | undefined;

const bind = (fs: ReturnType<typeof memLocalLogFs>) => {
  unbind = bindLocalLogs({
    fs,
    logsRoot: '/logs',
    sessionMode: 'doc',
    phoneDeviceId: 'phone',
    now: () => NOW,
  });
};

beforeEach(() => {
  resetWorkspace();
  resetSessionStores();
  uiPrefsStore.setState({ localLogsEnabled: false });
  installLocalLogWriter(undefined);
});

afterEach(() => {
  unbind?.();
  unbind = undefined;
  installLocalLogWriter(undefined);
});

test('file stamps round-trip in UTC and the UI adds the date off today', () => {
  expect(fileStamp(NOW)).toBe('2026-09-21T18-17-03');
  expect(parseLogFileAt('2026-09-21T18-17-03.txt')).toBe(
    Date.parse('2026-09-21T18:17:03Z'),
  );
  expect(parseLogFileAt('2026-09-21T18-17-03-2.txt')).toBe(
    Date.parse('2026-09-21T18:17:03Z'),
  );
  const at = Date.parse('2026-09-21T18:17:03Z');
  expect(formatLogStamp(at, at)).toBe(formatLogStamp(at, at));
  expect(formatLogStamp(at, Date.parse('2020-01-15T00:00:00Z'))).toContain(
    'Sep',
  );
  expect(formatLogStamp(at, at)).not.toContain('Sep');
});

test('disabled logging never touches the filesystem', async () => {
  const fs = memLocalLogFs();
  workspaceStore.setState({
    chats: [chat()],
    sessions: { c1: row('working') },
  });
  getSessionStore('c1').setState({
    commands: [runCommand()],
    entries: [entry([{ kind: 'text', id: 'p1', text: PROMPT }])],
  });
  bind(fs);
  routeRuntimeLog(`chat2 c1: ${PROMPT}`);
  await flush();
  expect(fs.calls).toBe(0);
  expect(fs.files.size).toBe(0);
});

test('a working run records safe diagnostics and closes on idle', async () => {
  const fs = memLocalLogFs();
  uiPrefsStore.setState({ localLogsEnabled: true });
  workspaceStore.setState({
    chats: [chat()],
    sessions: { c1: row('idle') },
  });
  getSessionStore('c1').setState({
    commands: [runCommand()],
    entries: [
      entry([
        { kind: 'text', id: 'p1', text: PROMPT },
        {
          kind: 'input',
          id: 'in1',
          requestId: 'req1',
          questions: [
            {
              id: 'q1',
              header: 'Check',
              question: PROMPT,
              options: ['yes'],
            },
          ],
          resolved: false,
        },
      ]),
    ],
    meta: { contextUsage: { tokens: 1200, window: 8000 } },
  });
  bind(fs);
  routeRuntimeLog('chat2 c1: caught up');
  workspaceStore.setState({
    sessions: { c1: row('working') },
  });
  await flush();

  const key = [...fs.files.keys()][0];
  expect(key).toContain('/logs/c1/2026-09-21T18-17-03.txt');
  let body = bodies(fs);
  expect(body).toContain(
    'run start chat=c1 device=host1 mode=doc roomGen=2 status=working',
  );
  expect(body).toContain('phase awaitingInput');
  expect(body).toContain('command id=cmd1 kind=run status=pending');
  expect(body).toContain('input request=req1 questions=1');
  expect(body).toContain('context count=1200 window=8000');
  expect(body).toContain('chat2 c1: caught up');
  expect(body).not.toContain(PROMPT);
  expect(body).not.toContain(TOOL_PATH);
  expect(body).not.toContain('/Users/ada');

  getSessionStore('c1').setState({
    room: 'disconnected',
    entries: [
      entry([
        { kind: 'text', id: 'p1', text: PROMPT },
        {
          kind: 'tool',
          id: 't1',
          call: { kind: 'readFile', path: TOOL_PATH },
          resolved: true,
          isError: false,
          outputBytes: 12,
          output: PROMPT,
        },
        { kind: 'error', id: 'err1', message: PROMPT },
      ]),
    ],
  });
  await flush();
  body = bodies(fs);
  expect(body).toContain('phase awaitingInput -> working');
  expect(body).toContain('room disconnected');
  expect(body).toContain(
    'tool id=t1 kind=readFile resolved=true isError=false outputBytes=12',
  );
  expect(body).toContain(`error part id=err1 len=${PROMPT.length}`);
  expect(body).not.toContain(PROMPT);
  expect(body).not.toContain('file.ts');

  routeRuntimeLog('registry: socket silent past lease');
  routeRuntimeLog('registry: token=supersecretvalue');
  routeRuntimeLog('relay host1: dial wss://edge.test');
  routeRuntimeLog('relay other: dial wss://elsewhere.test');
  routeRuntimeLog('chat2 other: should stay out');
  await flush();
  body = bodies(fs);
  expect(body).toContain('registry: socket silent past lease');
  expect(body).toContain('token=<redacted>');
  expect(body).toContain('relay host1: dial');
  expect(body).not.toContain('elsewhere');
  expect(body).not.toContain('chat2 other');
  expect(body).not.toContain('supersecretvalue');

  workspaceStore.setState({
    sessions: { c1: row('awaitingInput', NOW + 1000) },
  });
  await flush();
  expect(fs.files.size).toBe(1);
  expect(bodies(fs)).toContain('status working -> awaitingInput');

  workspaceStore.setState({
    sessions: { c1: row('idle', NOW + 5000) },
  });
  await flush();
  body = bodies(fs);
  expect(body).toContain('status awaitingInput -> idle');
  expect(body).toContain('run end status=idle durationMs=0');
  expect(fs.files.size).toBe(1);

  workspaceStore.setState({
    sessions: { c1: row('working', NOW + 6000) },
  });
  await flush();
  expect(fs.files.size).toBe(2);
  expect([...fs.files.keys()].some(k => k.endsWith('-2.txt'))).toBe(true);

  await deleteLocalLogs();
  expect(fs.files.size).toBe(0);
  expect(currentLocalLogWriter()).toBeDefined();
});

test('lines logged while disabled are not flushed after enabling', async () => {
  const fs = memLocalLogFs();
  workspaceStore.setState({
    chats: [chat()],
    sessions: { c1: row('idle') },
  });
  bind(fs);
  routeRuntimeLog(`chat2 c1: ${PROMPT}`);
  uiPrefsStore.setState({ localLogsEnabled: true });
  workspaceStore.setState({
    sessions: { c1: row('working') },
  });
  await flush();
  const body = bodies(fs);
  expect(body).toContain('run start');
  expect(body).not.toContain(PROMPT);
  expect(body).not.toContain('chat2 c1');
});

test('a run file truncates around the byte cap', async () => {
  const fs = memLocalLogFs();
  uiPrefsStore.setState({ localLogsEnabled: true });
  workspaceStore.setState({
    chats: [chat()],
    sessions: { c1: row('working') },
  });
  bind(fs);
  await flush();
  currentLocalLogWriter()?.append('c1', 'x'.repeat(600_000));
  await flush();
  const body = bodies(fs);
  expect(body).toContain('log truncated');
  expect(body.length).toBeLessThan(600_000);
});
