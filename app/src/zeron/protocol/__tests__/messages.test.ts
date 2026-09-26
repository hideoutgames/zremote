// Ported from zeron@853872d edge/src/session-doc/messages.ts behaviour and
// apps/ios/Zeron/Sync/SessionStore.swift (liveEntry, openInputRequest) +
// apps/ios/Zeron/Composer/Attachments.swift (withAttachments).

import {
  ATTACHMENT_ONLY_TEXT,
  joinContinuations,
  liveEntry,
  openInputRequest,
  parsePendingRef,
  pendingRef,
  attachmentName,
  parseUserMessageAttachments,
  userMessageRailText,
  withAttachments,
} from '../messages';
import type { MessageEntry, MessagePart } from '../types';

const text = (id: string, body: string): MessagePart => ({
  kind: 'text',
  id,
  text: body,
});

const entry = (
  id: string,
  parts: MessagePart[],
  over: Partial<MessageEntry> = {},
): MessageEntry => ({
  id,
  role: 'assistant',
  parts,
  createdAt: 1,
  deviceId: 'host-1',
  ...over,
});

describe('joinContinuations', () => {
  it('joins continuation parts onto their root, preserving order', () => {
    const out = joinContinuations([
      entry('a', [text('p1', 'hello ')]),
      entry('b', [text('p2', 'world')], { continuationOf: 'a' }),
      entry('c', [text('p3', '!')]),
    ]);
    expect(out.map(e => e.id)).toEqual(['a', 'c']);
    expect(out[0].parts.map(p => p.id)).toEqual(['p1', 'p2']);
  });

  it('chains: a continuation can itself be continued', () => {
    const out = joinContinuations([
      entry('a', [text('p1', 'x')]),
      entry('b', [text('p2', 'y')], { continuationOf: 'a' }),
      entry('c', [text('p3', 'z')], { continuationOf: 'b' }),
    ]);
    // Orphans are NOT indexed as roots (edge semantics): c has no visible
    // root, so it surfaces as its own entry.
    expect(out.map(e => e.id)).toEqual(['a', 'c']);
    expect(out[0].parts.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(out[1].parts.map(p => p.id)).toEqual(['p3']);
  });

  it('orphan continuations stay visible rather than being dropped', () => {
    const out = joinContinuations([
      entry('a', [text('p1', 'x')]),
      entry('b', [text('p2', 'y')], { continuationOf: 'missing' }),
    ]);
    expect(out.map(e => e.id)).toEqual(['a', 'b']);
    expect(out[1].continuationOf).toBe('missing');
  });

  it('returns a copy untouched when nothing continues', () => {
    const input = [
      entry('a', [text('p1', 'x')]),
      entry('b', [text('p2', 'y')]),
    ];
    expect(joinContinuations(input)).toEqual(input);
  });
});

describe('liveEntry', () => {
  it('returns the last streaming entry', () => {
    const entries = [
      entry('a', [], { status: 'streaming' }),
      entry('b', [], { status: 'complete' }),
      entry('c', [], { status: 'streaming' }),
    ];
    expect(liveEntry(entries)?.id).toBe('c');
    expect(liveEntry([entry('a', [], { status: 'complete' })])).toBeUndefined();
  });
});

describe('openInputRequest', () => {
  const question = {
    id: 'q1',
    header: 'h',
    question: 'pick',
    options: ['a', 'b'],
  };

  it('finds the last unresolved input part with non-empty questions', () => {
    const input = (id: string, resolved: boolean): MessagePart => ({
      kind: 'input',
      id,
      requestId: id,
      questions: [question],
      resolved,
    });
    const entries = [
      entry('e1', [input('r1', true)]),
      entry('e2', [input('r2', false)]),
      entry('e3', [input('r3', false)]),
    ];
    expect(openInputRequest(entries)).toEqual({
      entryId: 'e3',
      requestId: 'r3',
      questions: [question],
    });
  });

  it('skips resolved and empty-question inputs', () => {
    const entries = [
      entry('e1', [
        {
          kind: 'input',
          id: 'r1',
          requestId: 'r1',
          questions: [],
          resolved: false,
        },
        {
          kind: 'input',
          id: 'r2',
          requestId: 'r2',
          questions: [question],
          resolved: true,
        },
      ]),
    ];
    expect(openInputRequest(entries)).toBeUndefined();
  });
});

describe('withAttachments', () => {
  it('appends the local-files trailer', () => {
    expect(withAttachments('look at this', ['/tmp/a.png', '/tmp/b.png'])).toBe(
      'look at this\n\nAttached files (local files — open them to view):\n- /tmp/a.png\n- /tmp/b.png',
    );
  });

  it('uses the attachment-only body for empty text', () => {
    expect(withAttachments('', ['/tmp/a.png'])).toBe(
      `${ATTACHMENT_ONLY_TEXT}\n\nAttached files (local files — open them to view):\n- /tmp/a.png`,
    );
    expect(withAttachments('plain', [])).toBe('plain');
  });
});

describe('pendingRef', () => {
  it('round-trips pending://uploadId/name', () => {
    const ref = pendingRef('up-1', 'photo.png');
    expect(ref).toBe('pending://up-1/photo.png');
    expect(parsePendingRef(ref)).toEqual({
      uploadId: 'up-1',
      name: 'photo.png',
    });
    expect(parsePendingRef('pending://up-1/dir/name.png')).toEqual({
      uploadId: 'up-1',
      name: 'dir/name.png',
    });
    expect(parsePendingRef('file:///x')).toBeUndefined();
    expect(parsePendingRef('pending:///')).toBeUndefined();
  });
});

describe('parseUserMessageAttachments', () => {
  it('strips the host trailer and names the file, not the pending URL', () => {
    const raw = [
      'look at this',
      '',
      'Attached images (local files — open them to view):',
      '- pending://up-1/photo.png',
    ].join('\n');
    expect(parseUserMessageAttachments(raw)).toEqual({
      text: 'look at this',
      attachments: [{ path: 'pending://up-1/photo.png', name: 'photo.png' }],
    });
    expect(attachmentName('pending://up-1/photo.png')).toBe('photo.png');
    expect(userMessageRailText(raw)).toBe('look at this');
  });

  it('hides the attachment-only placeholder and keeps a committed path', () => {
    const raw = `${ATTACHMENT_ONLY_TEXT}\n\nAttached files (local files — open them to view):\n- /host/uploads/notes.pdf`;
    expect(parseUserMessageAttachments(raw)).toEqual({
      text: '',
      attachments: [{ path: '/host/uploads/notes.pdf', name: 'notes.pdf' }],
    });
    expect(
      userMessageRailText(
        'See the attached image(s).\n\nAttached images (local files — open them to view):\n- /host/a.png\n- /host/b.png',
      ),
    ).toBe('2 files');
  });

  it('leaves a prompt with no trailer unchanged', () => {
    expect(parseUserMessageAttachments('just text')).toEqual({
      text: 'just text',
      attachments: [],
    });
  });
});
