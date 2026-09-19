import {
  COMPOSE_DRAFT_ID,
  draftStore,
  moveDraft,
  resetDrafts,
  setDraftText,
} from '../src/zeron/state/draftStore';
import { createThreadFromCompose } from '../src/zeron/runtime/createThreadFromCompose';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import type { AppRuntime } from '../src/zeron/runtime/appRuntime';

beforeEach(() => {
  resetDrafts();
  uiPrefsStore.setState({ composeDefaults: undefined, recentModels: [] });
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
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

test('createThreadFromCompose writes the chat, moves the draft, and sendRun', async () => {
  const writes: {
    kind: string;
    id: string;
    set?: Record<string, unknown>;
  }[] = [];
  const sendRun = jest.fn();
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
      sendRun,
      sendWithAttachments: async () => 'legacy',
    }),
  } as unknown as AppRuntime;

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
        sandbox: 'danger-full-access',
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

test('createThreadFromCompose projectless when space is omitted', async () => {
  const sendRun = jest.fn();
  const runtime = {
    registryDoc: { write: () => {} },
    registry: { flushPending: () => {} },
    openSession: () => ({
      retain() {
        return this;
      },
      release() {},
      sendRun,
      sendWithAttachments: async () => 'legacy',
    }),
  } as unknown as AppRuntime;
  await createThreadFromCompose(runtime, {
    text: 'hi',
    settings: { deviceId: 'host1', harness: 'codex', model: 'gpt-5' },
  });
  expect(sendRun.mock.calls[0][1].cwd).toBeUndefined();
});

test('moveDraft relocates text without dropping it', () => {
  setDraftText(COMPOSE_DRAFT_ID, 'stash');
  moveDraft(COMPOSE_DRAFT_ID, 'c-new');
  expect(draftStore.getState().byChat[COMPOSE_DRAFT_ID]).toBeUndefined();
  expect(draftStore.getState().byChat['c-new']?.text).toBe('stash');
});
