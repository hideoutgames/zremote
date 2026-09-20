import {
  cloneEntry,
  reuseById,
  sameCommand,
  sameEntry,
  shareSessionProjection,
} from '../shareProjection';
import type { MessageEntry, SessionCommandEntry } from '../../protocol/types';

const entry = (
  id: string,
  text: string,
  extra: Partial<MessageEntry> = {},
): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', id: 't0', text }],
  createdAt: 1,
  deviceId: 'host',
  ...extra,
});

const cmd = (
  id: string,
  extra: Partial<SessionCommandEntry> = {},
): SessionCommandEntry => ({
  id,
  kind: 'run',
  payload: { kind: 'run', request: {} as never, messageId: 'm1' },
  issuedBy: 'phone',
  issuedAt: 1,
  status: 'pending',
  ...extra,
});

describe('shareSessionProjection', () => {
  it('reuses unchanged prior entries and the commands array', () => {
    const prev = {
      entries: [entry('a', 'hello'), entry('b', 'wor')],
      commands: [cmd('c1')],
      queue: [],
      meta: { chatId: 'x' },
    };
    const next = {
      entries: [entry('a', 'hello'), entry('b', 'world')],
      commands: [cmd('c1')],
      queue: [],
      meta: { chatId: 'x' },
    };
    const shared = shareSessionProjection(prev, next);
    expect(shared.entries).not.toBe(prev.entries);
    expect(shared.entries[0]).toBe(prev.entries[0]);
    expect(shared.entries[1]).not.toBe(prev.entries[1]);
    expect(shared.entries[1].parts[0]).toMatchObject({ text: 'world' });
    expect(shared.commands).toBe(prev.commands);
    expect(shared.meta).toBe(prev.meta);
  });

  it('returns the previous entries array when nothing changed', () => {
    const prev = {
      entries: [entry('a', 'hello')],
      commands: [],
      queue: [],
      meta: {},
    };
    const shared = shareSessionProjection(prev, {
      entries: [entry('a', 'hello')],
      commands: [],
      queue: [],
      meta: {},
    });
    expect(shared.entries).toBe(prev.entries);
  });

  it('cloneEntry breaks identity so in-place text growth is visible', () => {
    const live = entry('a', 'hel');
    const published = cloneEntry(live);
    (live.parts[0] as { text: string }).text = 'hello';
    expect(sameEntry(published, live)).toBe(false);
    expect(reuseById([published], [cloneEntry(live)], sameEntry)[0]).not.toBe(
      published,
    );
  });

  it('sameCommand treats a status change as distinct', () => {
    expect(sameCommand(cmd('c1'), cmd('c1', { status: 'applied' }))).toBe(
      false,
    );
  });
});
