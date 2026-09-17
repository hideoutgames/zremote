// Ported from zeron@853872d — host-shaped Loro docs built with raw
// loro-crdt (messages/parts/commands/queue/meta containers exactly as
// crates/doc/src/schema.rs writes them) mirrored through SessionDoc.

import { LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt';
import { LoroCrdtAdapter } from '../loroCrdtAdapter';
import {
  buildInterrupt,
  buildRespondInput,
  buildRunCommand,
  buildSteer,
  SessionDoc,
} from '../sessionDoc';
import { COMMAND_DEFAULT_TTL_MS } from '../../protocol/types';

/** Build a host-shaped session doc (schema.rs root containers). */
const hostDoc = () => {
  const doc = new LoroDoc();
  doc.getMap('meta').set('chatId', 'chat-1');
  return doc;
};

const pushMessage = (
  doc: LoroDoc,
  fields: Record<string, unknown>,
  parts: Record<string, unknown>[],
) => {
  const msg = doc.getList('messages').pushContainer(new LoroMap());
  for (const [k, v] of Object.entries(fields)) msg.set(k, v as never);
  const partsList = msg.setContainer('parts', new LoroList());
  for (const p of parts) {
    const map = partsList.pushContainer(new LoroMap());
    for (const [k, v] of Object.entries(p)) {
      if (v instanceof LoroText) map.setContainer(k, v);
      else map.set(k, v as never);
    }
  }
  return msg;
};

const streamingText = (body: string) => {
  const t = new LoroText();
  t.insert(0, body);
  return t;
};

const mirror = (
  host: LoroDoc,
): { adapter: LoroCrdtAdapter; doc: SessionDoc } => {
  const adapter = new LoroCrdtAdapter();
  adapter.import(host.export({ mode: 'update' }));
  return { adapter, doc: new SessionDoc(adapter) };
};

describe('SessionDoc.project', () => {
  it('decodes host-shaped messages with LoroText bodies', () => {
    const host = hostDoc();
    pushMessage(
      host,
      { id: 'm1', role: 'user', createdAt: 1, deviceId: 'host-1' },
      [{ id: 'p1', kind: 'text', text: streamingText('run the tests') }],
    );
    pushMessage(
      host,
      {
        id: 'm2',
        role: 'assistant',
        createdAt: 2,
        deviceId: 'host-1',
        status: 'streaming',
      },
      [{ id: 'p2', kind: 'text', text: streamingText('streaming half of a') }],
    );
    host.commit();

    const { doc } = mirror(host);
    const p = doc.project();
    expect(p).toBeDefined();
    expect(p!.entries).toHaveLength(2);
    expect(p!.entries[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      parts: [{ kind: 'text', id: 'p1', text: 'run the tests' }],
    });
    expect(p!.entries[1].status).toBe('streaming');
    expect(p!.entries[1].parts[0]).toEqual({
      kind: 'text',
      id: 'p2',
      text: 'streaming half of a',
    });
    expect(p!.meta.chatId).toBe('chat-1');
  });

  it('isError presence resolves a tool part (false counts)', () => {
    const host = hostDoc();
    pushMessage(
      host,
      { id: 'm1', role: 'assistant', createdAt: 1, deviceId: 'h' },
      [
        { id: 't1', kind: 'tool', call: { kind: 'exec', command: 'ls' } },
        {
          id: 't2',
          kind: 'tool',
          call: { kind: 'exec', command: 'rm' },
          isError: false,
        },
        {
          id: 't3',
          kind: 'tool',
          call: { kind: 'exec', command: 'x' },
          isError: true,
          output: 'denied',
        },
      ],
    );
    host.commit();
    const { doc } = mirror(host);
    const parts = doc.project()!.entries[0].parts;
    expect(parts[0]).toMatchObject({ kind: 'tool', resolved: false });
    expect('isError' in parts[0]).toBe(false);
    expect(parts[1]).toMatchObject({
      kind: 'tool',
      resolved: true,
      isError: false,
    });
    expect(parts[2]).toMatchObject({
      kind: 'tool',
      resolved: true,
      isError: true,
      output: 'denied',
    });
  });

  it('invalid image parts degrade to error parts; valid ones pass through', () => {
    const host = hostDoc();
    pushMessage(
      host,
      { id: 'm1', role: 'assistant', createdAt: 1, deviceId: 'h' },
      [
        {
          id: 'i1',
          kind: 'image',
          path: '/tmp/a.png',
          name: 'a.png',
          mimeType: 'image/png',
        },
        {
          id: 'i2',
          kind: 'image',
          path: 'rel/a.png',
          name: 'a.png',
          mimeType: 'image/png',
        },
        {
          id: 'i3',
          kind: 'image',
          path: '/tmp/b.exe',
          name: 'b.exe',
          mimeType: 'app/x',
        },
      ],
    );
    host.commit();
    const parts = mirror(host).doc.project()!.entries[0].parts;
    expect(parts[0]).toEqual({
      kind: 'image',
      id: 'i1',
      path: '/tmp/a.png',
      name: 'a.png',
      mimeType: 'image/png',
    });
    expect(parts[1]).toEqual({
      kind: 'error',
      id: 'i2',
      message: 'Generated image unavailable',
    });
    expect(parts[2]).toEqual({
      kind: 'error',
      id: 'i3',
      message: 'Generated image unavailable',
    });
  });

  it('unknown part kinds are dropped', () => {
    const host = hostDoc();
    pushMessage(
      host,
      { id: 'm1', role: 'assistant', createdAt: 1, deviceId: 'h' },
      [
        { id: 'x1', kind: 'hologram', z: 1 },
        { id: 'p1', kind: 'text', text: streamingText('kept') },
      ],
    );
    host.commit();
    const parts = mirror(host).doc.project()!.entries[0].parts;
    expect(parts.map(p => p.id)).toEqual(['p1']);
  });

  it('joins continuations; orphans stay visible', () => {
    const host = hostDoc();
    pushMessage(
      host,
      { id: 'a', role: 'assistant', createdAt: 1, deviceId: 'h' },
      [{ id: 'p1', kind: 'text', text: streamingText('one ') }],
    );
    pushMessage(
      host,
      {
        id: 'b',
        role: 'assistant',
        createdAt: 2,
        deviceId: 'h',
        continuationOf: 'a',
      },
      [{ id: 'p2', kind: 'text', text: streamingText('two') }],
    );
    pushMessage(
      host,
      {
        id: 'c',
        role: 'assistant',
        createdAt: 3,
        deviceId: 'h',
        continuationOf: 'gone',
      },
      [{ id: 'p3', kind: 'text', text: streamingText('orphan') }],
    );
    host.commit();
    const entries = mirror(host).doc.project()!.entries;
    expect(entries.map(e => e.id)).toEqual(['a', 'c']);
    expect(
      entries[0].parts.map(p => (p as { text: string }).text).join(''),
    ).toBe('one two');
  });

  it('decodes queue rows and meta.contextUsage', () => {
    const host = hostDoc();
    const q = host.getMovableList('queue').pushContainer(new LoroMap());
    q.set('id', 'q1');
    q.set('text', 'queued hello');
    q.set('issuedBy', 'phone-1');
    q.set('issuedAt', 42);
    host
      .getMap('meta')
      .set('contextUsage', JSON.stringify({ tokens: 100, window: 200 }));
    host.commit();
    const p = mirror(host).doc.project()!;
    expect(p.queue).toEqual([
      { id: 'q1', text: 'queued hello', issuedBy: 'phone-1', issuedAt: 42 },
    ]);
    expect(p.meta.contextUsage).toEqual({ tokens: 100, window: 200 });
  });
});

describe('SessionDoc.queueCommand', () => {
  it('writes the command ledger entry and the host sees the exact fields', () => {
    const host = hostDoc();
    const { adapter, doc } = mirror(host);

    const commandId = doc.queueCommand({
      kind: 'interrupt',
      payload: buildInterrupt(),
      deviceId: 'phone-1',
      nowMs: 5000,
      basedOnTurnId: 'turn-9',
    });
    expect(commandId).toMatch(/^[0-9a-f-]{36}$/);

    // Ship the update to the host like a `push` frame would.
    host.import(adapter.exportUpdatesFrom(null));
    const commands = (host.toJSON() as { commands: Record<string, unknown>[] })
      .commands;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      id: commandId,
      kind: 'interrupt',
      payload: { kind: 'interrupt' },
      issuedBy: 'phone-1',
      issuedAt: 5000,
      basedOn: { turnId: 'turn-9', frontier: null },
      expiresAt: 5000 + COMMAND_DEFAULT_TTL_MS,
      status: 'pending',
    });
  });

  it('buildRunCommand mirrors sendRun: defaults, omitted harness/worktree', () => {
    const payload = buildRunCommand('hi', {
      config: { model: 'm1', modelOptions: { x: 1 } },
      cwd: '/repo',
    });
    if (payload.kind !== 'run') throw new Error('expected run payload');
    expect(payload).toMatchObject({
      kind: 'run',
      request: {
        prompt: 'hi',
        model: 'm1',
        reasoning: null,
        modelOptions: { x: 1 },
        cwd: '/repo',
        sandbox: 'workspace-write',
        autoApprove: true,
        resume: null,
      },
    });
    const request = payload.request as unknown as Record<string, unknown>;
    expect('harness' in request).toBe(false);
    expect('worktree' in request).toBe(false);
    expect('attachments' in request).toBe(false);
    expect(payload.messageId).toMatch(/^[0-9a-f-]{36}$/);

    const withWorktree = buildRunCommand(
      'hi',
      { cwd: '/r' },
      { worktree: { repoPath: '/r', base: 'main' }, attachments: ['/a.png'] },
    );
    if (withWorktree.kind !== 'run') throw new Error('expected run payload');
    const r2 = withWorktree.request as unknown as Record<string, unknown>;
    expect(r2.worktree).toEqual({ repoPath: '/r', base: 'main' });
    expect(r2.attachments).toEqual(['/a.png']);
    expect(r2.harness).toBeUndefined();
  });

  it('buildSteer / buildRespondInput payload shapes', () => {
    expect(buildSteer('go left', 'm-1')).toEqual({
      kind: 'steer',
      prompt: 'go left',
      messageId: 'm-1',
    });
    expect(
      buildRespondInput('req-1', [{ questionId: 'q1', labels: ['yes'] }]),
    ).toEqual({
      kind: 'respondInput',
      requestId: 'req-1',
      answers: [{ questionId: 'q1', labels: ['yes'] }],
    });
  });

  it('cancelOwnCommand only cancels own pending entries', () => {
    const host = hostDoc();
    const { adapter, doc } = mirror(host);
    const mine = doc.queueCommand({
      kind: 'steer',
      payload: buildSteer('x', 'm'),
      deviceId: 'phone-1',
      nowMs: 1,
    });
    const theirs = doc.queueCommand({
      kind: 'steer',
      payload: buildSteer('y', 'm'),
      deviceId: 'phone-2',
      nowMs: 2,
    });
    expect(doc.cancelOwnCommand(theirs, 'phone-1')).toBe(false);
    expect(doc.cancelOwnCommand(mine, 'phone-1')).toBe(true);
    expect(doc.cancelOwnCommand(mine, 'phone-1')).toBe(false); // already terminal

    host.import(adapter.exportUpdatesFrom(null));
    const cmds = (
      host.toJSON() as { commands: { id: string; status: string }[] }
    ).commands;
    expect(cmds.find(c => c.id === mine)!.status).toBe('cancelled');
    expect(cmds.find(c => c.id === theirs)!.status).toBe('pending');
  });

  it('adoptPendingCommandsFrom carries own unexpired pending commands', () => {
    const legacyRoot = {
      commands: [
        {
          id: 'keep',
          kind: 'steer',
          payload: { kind: 'steer', prompt: 'p', messageId: 'm' },
          issuedBy: 'me',
          issuedAt: 10,
          expiresAt: 2000,
          status: 'pending',
        },
        {
          id: 'other-device',
          kind: 'steer',
          payload: {},
          issuedBy: 'them',
          issuedAt: 10,
          status: 'pending',
        },
        {
          id: 'applied',
          kind: 'steer',
          payload: {},
          issuedBy: 'me',
          issuedAt: 10,
          status: 'applied',
        },
        {
          id: 'expired',
          kind: 'steer',
          payload: {},
          issuedBy: 'me',
          issuedAt: 10,
          expiresAt: 999,
          status: 'pending',
        },
        {
          id: 'bad',
          payload: {},
          issuedBy: 'me',
          issuedAt: 10,
          status: 'pending',
        },
      ],
    };
    const { doc } = mirror(hostDoc());
    expect(doc.adoptPendingCommandsFrom(legacyRoot, 'me', 1000)).toBe(1);
    const carried = doc.project()!.commands;
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      id: 'keep',
      issuedBy: 'me',
      status: 'pending',
    });
    expect(carried[0].basedOn).toBeUndefined();
  });
});
