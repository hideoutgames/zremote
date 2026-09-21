import {
  COMPOSE_DRAFT_ID,
  draftStore,
  moveDraft,
  resetDrafts,
  setDraftText,
  stageAttachments,
} from '../src/zeron/state/draftStore';
import { createThreadFromCompose } from '../src/zeron/runtime/createThreadFromCompose';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import type { AppRuntime } from '../src/zeron/runtime/appRuntime';

const mockRuntime = (
  over: {
    sendRun?: jest.Mock;
    sendWithAttachments?: jest.Mock;
    queueMessage?: jest.Mock;
    start?: jest.Mock;
  } = {},
) => {
  const writes: {
    kind: string;
    id: string;
    set?: Record<string, unknown>;
  }[] = [];
  const sendRun = over.sendRun ?? jest.fn();
  const sendWithAttachments =
    over.sendWithAttachments ?? jest.fn(async () => 'legacy');
  const queueMessage = over.queueMessage ?? jest.fn();
  const start = over.start ?? jest.fn(async () => {});
  const runtime = {
    registryDoc: {
      write: (
        kind: string,
        id: string,
        _op?: string,
        set?: Record<string, unknown>,
      ) => writes.push({ kind, id, set }),
    },
    registry: { flushPending: () => {} },
    openSession: () => ({
      retain() {
        return this;
      },
      release() {},
      start,
      sendRun,
      sendWithAttachments,
      queueMessage,
    }),
  } as unknown as AppRuntime;
  return { runtime, writes, sendRun, sendWithAttachments, queueMessage, start };
};

beforeEach(() => {
  resetDrafts();
  uiPrefsStore.setState({
    composeDefaults: undefined,
    recentModels: [],
    modelSettingsByKey: {},
  });
  workspaceStore.setState({
    devices: [],
    spaces: [
      {
        id: 's1',
        deviceId: 'host1',
        path: '/repo',
        gitDetected: true,
        createdAt: 0,
      },
    ],
    chats: [],
    sessions: {},
    presence: { host1: Date.now() },
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

test('createThreadFromCompose writes the chat, moves the draft, and sendRun', async () => {
  let started = false;
  const { runtime, writes, sendRun, start } = mockRuntime({
    start: jest.fn(async () => {
      await Promise.resolve();
      started = true;
    }),
    sendRun: jest.fn(() => {
      expect(started).toBe(true);
    }),
  });

  setDraftText(COMPOSE_DRAFT_ID, 'hello from compose');
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]?.text).toBe(
    'hello from compose',
  );

  const chatId = await createThreadFromCompose(runtime, {
    text: 'hello from compose',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
      reasoning: 'high',
    },
    branch: 'main',
  });

  expect(chatId).toBeTruthy();
  expect(start).toHaveBeenCalled();
  expect(writes.some(w => w.kind === 'chats' && w.id === chatId)).toBe(true);
  expect(
    writes.some(
      w => w.kind === 'chats' && w.id === chatId && w.set?.branch === 'main',
    ),
  ).toBe(true);
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]).toBeUndefined();
  expect(sendRun).toHaveBeenCalledWith(
    'hello from compose',
    expect.objectContaining({
      config: expect.objectContaining({
        harness: 'claude-code',
        model: 'sonnet',
        reasoning: 'high',
        sandbox: 'workspace-write',
        modelOptions: {},
      }),
      cwd: '/repo',
    }),
    {},
  );
  expect(uiPrefsStore.getState().composeDefaults).toEqual({
    deviceId: 'host1',
    spaceId: 's1',
    harness: 'claude-code',
    model: 'sonnet',
    reasoning: 'high',
  });
});

test('createThreadFromCompose puts Fast modelOptions on the chat and first run', async () => {
  const { runtime, writes, sendRun } = mockRuntime();
  const chatId = await createThreadFromCompose(runtime, {
    text: 'go fast',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
      reasoning: 'high',
      modelOptions: { fast: 'on' },
    },
  });
  const created = writes.find(w => w.kind === 'chats' && w.id === chatId);
  expect(created?.set?.config).toEqual(
    expect.objectContaining({
      modelOptions: { fast: 'on' },
    }),
  );
  expect(sendRun).toHaveBeenCalledWith(
    'go fast',
    expect.objectContaining({
      config: expect.objectContaining({
        modelOptions: { fast: 'on' },
      }),
    }),
    {},
  );
});

test('createThreadFromCompose sendRun carries a new worktree', async () => {
  const { runtime, sendRun } = mockRuntime();
  const worktree = { repoPath: '/repo', base: 'main' };
  await createThreadFromCompose(runtime, {
    text: 'in a worktree',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
    },
    worktree,
  });
  expect(sendRun).toHaveBeenCalledWith(
    'in a worktree',
    expect.objectContaining({
      cwd: '/repo',
    }),
    { worktree },
  );
});

test('createThreadFromCompose sendWithAttachments keeps staged files and settings', async () => {
  const attachments = stageAttachments(COMPOSE_DRAFT_ID, [
    {
      kind: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      localUri: 'file:///shot.png',
    },
  ]);
  const sendWithAttachments = jest.fn(async () => 'legacy' as const);
  const sendRun = jest.fn();
  const { runtime } = mockRuntime({ sendRun, sendWithAttachments });
  const worktree = { repoPath: '/repo', base: 'feat' };
  await createThreadFromCompose(runtime, {
    text: 'see pic',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
      reasoning: 'high',
      modelOptions: { fast: 'on' },
    },
    worktree,
    attachments,
  });
  expect(sendRun).not.toHaveBeenCalled();
  expect(sendWithAttachments).toHaveBeenCalledWith(
    'see pic',
    expect.objectContaining({
      config: expect.objectContaining({
        harness: 'claude-code',
        model: 'sonnet',
        reasoning: 'high',
        modelOptions: { fast: 'on' },
      }),
      cwd: '/repo',
    }),
    attachments,
    expect.objectContaining({
      worktree,
      phase: 'idle',
      draftChatId: COMPOSE_DRAFT_ID,
    }),
  );
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]).toBeUndefined();
});

test('createThreadFromCompose keeps the compose draft when sendWithAttachments throws', async () => {
  setDraftText(COMPOSE_DRAFT_ID, 'keep me');
  const attachments = stageAttachments(COMPOSE_DRAFT_ID, [
    {
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 4,
      localUri: 'file:///notes.txt',
    },
  ]);
  const { runtime } = mockRuntime({
    sendWithAttachments: jest.fn(async () => {
      throw new Error('upload failed');
    }),
  });
  await expect(
    createThreadFromCompose(runtime, {
      text: 'keep me',
      settings: {
        deviceId: 'host1',
        spaceId: 's1',
        harness: 'claude-code',
        model: 'sonnet',
      },
      attachments,
    }),
  ).rejects.toThrow(/upload failed/);
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]?.text).toBe('keep me');
});

test('createThreadFromCompose projectless when space is omitted', async () => {
  const { runtime, sendRun } = mockRuntime();
  await createThreadFromCompose(runtime, {
    text: 'hi',
    settings: { deviceId: 'host1', harness: 'codex', model: 'gpt-5' },
  });
  expect(sendRun.mock.calls[0][1].cwd).toBeUndefined();
});

test('createThreadFromCompose keeps the compose draft when host is missing', async () => {
  const { runtime } = mockRuntime();
  setDraftText(COMPOSE_DRAFT_ID, 'do not lose this');
  await expect(
    createThreadFromCompose(runtime, {
      text: 'do not lose this',
      settings: { deviceId: '', harness: '', model: '' },
    }),
  ).rejects.toThrow(/host and agent/);
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]?.text).toBe(
    'do not lose this',
  );
});

test('createThreadFromCompose queues the first message when the host is offline', async () => {
  workspaceStore.setState({ presence: {} });
  const { runtime, sendRun, queueMessage } = mockRuntime();
  await createThreadFromCompose(runtime, {
    text: 'park me',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
    },
  });
  expect(sendRun).not.toHaveBeenCalled();
  expect(queueMessage).toHaveBeenCalledWith('park me');
});

test('createThreadFromCompose force-queues attachments when the host is offline', async () => {
  workspaceStore.setState({ presence: {} });
  const attachments = stageAttachments(COMPOSE_DRAFT_ID, [
    {
      kind: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      size: 12,
      localUri: 'file:///shot.png',
    },
  ]);
  const sendWithAttachments = jest.fn(async () => 'queue' as const);
  const { runtime, sendRun } = mockRuntime({ sendWithAttachments });
  await createThreadFromCompose(runtime, {
    text: 'see pic',
    settings: {
      deviceId: 'host1',
      spaceId: 's1',
      harness: 'claude-code',
      model: 'sonnet',
    },
    attachments,
  });
  expect(sendRun).not.toHaveBeenCalled();
  expect(sendWithAttachments).toHaveBeenCalledWith(
    'see pic',
    expect.anything(),
    attachments,
    expect.objectContaining({ forceQueue: true }),
  );
});

test('moveDraft relocates text without dropping it', () => {
  setDraftText(COMPOSE_DRAFT_ID, 'stash');
  moveDraft(COMPOSE_DRAFT_ID, 'c-new');
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]).toBeUndefined();
  expect(draftStore.getState().byChat['c-new']?.text).toBe('stash');
});
