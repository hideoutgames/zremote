// Ported from zeron@853872d apps/ios/Zeron/Sync/WorkspaceStore.swift
// project()/derived views + write set-shapes.

import { RegistryDoc } from '../registryDoc';
import {
  archivedChats,
  buildArchivedSet,
  buildChatCheckoutSet,
  buildChatConfigSet,
  buildCreateChatSet,
  buildDeleteChatKeys,
  buildDeleteSpaceKeys,
  buildMarkSeenSet,
  buildRenameSet,
  chatsInSpace,
  overviewChats,
  projectWorkspace,
  spaceIndicator,
} from '../workspaceProjection';
import { encodeHlc, type Row } from '../../protocol/registryCore';

const DEV = 'dev-phone';
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

const seeded = (rows: Row[]): RegistryDoc => {
  const doc = new RegistryDoc(DEV, () => 5000);
  doc.applyState(1, true, 0, rows);
  return doc;
};

const fixture = () =>
  seeded([
    mkRow('devices', 'dev-1', {
      id: 'dev-1',
      name: 'Mac',
      platform: 'macos',
      version: '0.2.72',
      capabilities: ['message-queue-v1'],
    }),
    mkRow('spaces', 'sp-1', {
      id: 'sp-1',
      deviceId: 'dev-1',
      path: '/code/repo',
      gitDetected: true,
      createdAt: 10,
    }),
    mkRow('chats', 'c-space', {
      id: 'c-space',
      deviceId: 'dev-1',
      spaceId: 'sp-1',
      archived: false,
      createdAt: 20,
      lastMessageAt: 100,
    }),
    mkRow('chats', 'c-orphan', {
      id: 'c-orphan',
      deviceId: 'dev-1',
      spaceId: 'gone',
      archived: false,
      createdAt: 21,
    }),
    mkRow('chats', 'c-free', {
      id: 'c-free',
      deviceId: 'dev-1',
      archived: false,
      createdAt: 22,
      lastMessageAt: 50,
    }),
    mkRow('chats', 'c-arch', {
      id: 'c-arch',
      deviceId: 'dev-1',
      archived: true,
      createdAt: 23,
      lastMessageAt: 90,
    }),
    mkRow('sessions', 'c-space', {
      chatId: 'c-space',
      deviceId: 'dev-1',
      status: 'working',
      updatedAt: 5000,
    }),
    // A chat row missing deviceId is dropped by the projection.
    mkRow('chats', 'c-bad', { archived: false, createdAt: 24 }),
    // A session with an unknown status is dropped.
    mkRow('sessions', 'c-weird', {
      chatId: 'c-weird',
      deviceId: 'dev-1',
      status: 'quantum',
    }),
  ]);

describe('projectWorkspace', () => {
  it('projects devices/spaces/chats/sessions with Zeron field names', () => {
    const w = projectWorkspace(fixture());
    expect(w.devices).toEqual([
      {
        id: 'dev-1',
        name: 'Mac',
        platform: 'macos',
        version: '0.2.72',
        capabilities: ['message-queue-v1'],
      },
    ]);
    expect(w.spaces).toEqual([
      {
        id: 'sp-1',
        deviceId: 'dev-1',
        path: '/code/repo',
        gitDetected: true,
        createdAt: 10,
      },
    ]);
    expect(w.chats.map(c => c.id).sort()).toEqual([
      'c-arch',
      'c-free',
      'c-orphan',
      'c-space',
    ]);
    expect(w.sessions['c-space']).toMatchObject({
      status: 'working',
      updatedAt: 5000,
    });
    expect(w.sessions['c-weird']).toBeUndefined();
  });
});

describe('derived views', () => {
  const now = 5000 + 1;
  it('overviewChats: non-archived, projectless-or-live-space, recency order', () => {
    const w = projectWorkspace(fixture());
    // c-orphan's space is gone → excluded; c-arch archived → excluded.
    expect(overviewChats(w).map(c => c.id)).toEqual(['c-space', 'c-free']);
  });

  it('chatsInSpace and archivedChats', () => {
    const w = projectWorkspace(fixture());
    expect(chatsInSpace(w, 'sp-1').map(c => c.id)).toEqual(['c-space']);
    expect(archivedChats(w).map(c => c.id)).toEqual(['c-arch']);
    expect(archivedChats(w, 'sp-1')).toEqual([]);
  });

  it('spaceIndicator aggregates the most urgent member status', () => {
    const w = projectWorkspace(fixture());
    expect(spaceIndicator(w, 'sp-1', now)).toBe('working');
    expect(spaceIndicator(w, 'none', now)).toBeUndefined();
  });
});

describe('write set-shapes', () => {
  it('buildCreateChatSet matches workspace_host create_chat', () => {
    const { chatId, ...op } = buildCreateChatSet({
      chatId: 'chat-9',
      deviceId: 'dev-1',
      spaceId: 'sp-1',
      cwd: '/code/repo',
      config: {
        harness: 'claude-code',
        modelOptions: {},
        sandbox: 'workspace-write',
      },
      branch: 'main',
      nowMs: 777,
    });
    expect(chatId).toBe('chat-9');
    expect(op).toEqual({
      kind: 'chats',
      id: 'chat-9',
      op: 'upsert',
      set: {
        id: 'chat-9',
        deviceId: 'dev-1',
        archived: false,
        cwd: '/code/repo',
        createdAt: 777,
        roomGen: 2,
        spaceId: 'sp-1',
        branch: 'main',
        config: {
          harness: 'claude-code',
          modelOptions: {},
          sandbox: 'workspace-write',
        },
      },
    });
  });

  it('field set-shapes', () => {
    expect(buildArchivedSet(true)).toEqual({ archived: true });
    expect(buildMarkSeenSet(42)).toEqual({ lastSeenAt: 42 });
    expect(buildRenameSet('New name')).toEqual({ title: 'New name' });
    expect(buildChatCheckoutSet('/repo', 'dev')).toEqual({
      cwd: '/repo',
      branch: 'dev',
    });
    expect(buildChatConfigSet({ harness: 'codex', modelOptions: {} })).toEqual({
      config: { harness: 'codex', modelOptions: {} },
    });
  });

  it('delete key batches', () => {
    expect(buildDeleteChatKeys('c1')).toEqual([
      { kind: 'chats', id: 'c1' },
      { kind: 'sessions', id: 'c1' },
    ]);
    const w = projectWorkspace(fixture());
    expect(buildDeleteSpaceKeys(w, 'sp-1')).toEqual([
      { kind: 'chats', id: 'c-space' },
      { kind: 'sessions', id: 'c-space' },
      { kind: 'spaces', id: 'sp-1' },
    ]);
  });

  it('an update op via the doc flows into the overlay', () => {
    const doc = fixture();
    doc.write('chats', 'c-free', 'update', buildRenameSet('renamed'));
    expect(doc.overlayRow('chats', 'c-free')?.fields.title).toBe('renamed');
  });
});
