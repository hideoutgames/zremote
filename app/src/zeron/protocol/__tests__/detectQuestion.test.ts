// openQuestion: layered detection for questions the host never wrapped in
// an `input` part — unresolved question-shaped tool calls (Cursor
// askQuestion, Codex request_user_input, MCP elicitations) and trailing
// prose questions — plus the steer-format answer (respond_input_prompt
// parity) and the answered-ids dismissal.

import {
  formatQuestionAnswer,
  openQuestion,
  sameOpenQuestion,
  type OpenQuestion,
} from '../detectQuestion';
import type { MessageEntry, MessagePart, RenderToolCall } from '../types';

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

const tool = (
  id: string,
  call: Record<string, unknown>,
  resolved = false,
): MessagePart => ({
  kind: 'tool',
  id,
  call: call as RenderToolCall,
  resolved,
  ...(resolved ? { isError: false } : {}),
});

const inputPart = (id: string, resolved: boolean): MessagePart => ({
  kind: 'input',
  id,
  requestId: id,
  questions: [
    { id: 'q1', header: 'h', question: 'pick one', options: ['a', 'b'] },
  ],
  resolved,
});

describe('openQuestion — input parts', () => {
  it('returns the unresolved input part, kind input', () => {
    const q = openQuestion([entry('e1', [inputPart('r1', false)])]);
    expect(q).toEqual({
      kind: 'input',
      id: 'r1',
      entryId: 'e1',
      requestId: 'r1',
      questions: [
        { id: 'q1', header: 'h', question: 'pick one', options: ['a', 'b'] },
      ],
    });
  });

  it('input part wins over a trailing prose question', () => {
    const q = openQuestion([
      entry('e1', [inputPart('r1', false)]),
      entry('e2', [text('t1', 'Everything is done. Continue?')], {
        status: 'complete',
      }),
    ]);
    expect(q?.kind).toBe('input');
  });
});

describe('openQuestion — question tool calls', () => {
  it('finds askQuestion by name with no args (name-only unknown call)', () => {
    const q = openQuestion([
      entry('e1', [tool('tc1', { kind: 'unknown', name: 'askQuestion' })]),
    ]);
    expect(q).toMatchObject({ kind: 'tool', id: 'tc1', entryId: 'e1' });
    expect(q?.questions).toEqual([
      { id: 'q0', header: 'Agent question', question: '', options: [] },
    ]);
  });

  it('matches spellings: request_user_input, AskUserQuestion, elicitation/create', () => {
    for (const name of [
      'request_user_input',
      'requestUserInput',
      'AskUserQuestion',
      'elicitation/create',
      'ask_followup_question',
    ]) {
      const q = openQuestion([
        entry('e1', [tool('tc', { kind: 'unknown', name })]),
      ]);
      expect(q?.kind).toBe('tool');
    }
  });

  it('parses questions + options from the call args bag', () => {
    const q = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'request_user_input',
          args: {
            questions: [
              {
                id: 'env',
                header: 'Environments',
                question: 'Which environments?',
                options: [{ label: 'staging' }, 'production'],
                multiSelect: true,
              },
              { question: 'Rollback on failure?', options: ['Yes', 'No'] },
            ],
          },
        }),
      ]),
    ]);
    expect(q?.questions).toEqual([
      {
        id: 'env',
        header: 'Environments',
        question: 'Which environments?',
        options: ['staging', 'production'],
        multiSelect: true,
      },
      {
        id: 'q1',
        header: 'Agent question',
        question: 'Rollback on failure?',
        options: ['Yes', 'No'],
      },
    ]);
  });

  it('parses a lone question string from input/arguments bags', () => {
    const q = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'askQuestion',
          input: { question: 'Proceed?', choices: ['Yes', 'No'] },
        }),
      ]),
    ]);
    expect(q?.questions).toEqual([
      {
        id: 'q0',
        header: 'Agent question',
        question: 'Proceed?',
        options: ['Yes', 'No'],
      },
    ]);
  });

  it('reads mcp calls by their tool field', () => {
    const q = openQuestion([
      entry('e1', [
        tool('tc1', { kind: 'mcp', server: 's', tool: 'elicitation/create' }),
      ]),
    ]);
    expect(q?.kind).toBe('tool');
  });

  it('skips resolved tool parts and non-question names', () => {
    expect(
      openQuestion([
        entry('e1', [
          tool('tc1', { kind: 'unknown', name: 'askQuestion' }, true),
        ]),
      ]),
    ).toBeUndefined();
    expect(
      openQuestion([
        entry('e1', [tool('tc1', { kind: 'unknown', name: 'shell' })]),
        entry('e2', [text('t1', 'statement, no question')], {
          status: 'complete',
        }),
      ]),
    ).toBeUndefined();
  });

  it('generic names (ask, elicit) need parseable questions', () => {
    expect(
      openQuestion([
        entry('e1', [tool('tc1', { kind: 'unknown', name: 'ask' })]),
      ]),
    ).toBeUndefined();
    const q = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'ask',
          args: { prompt: 'Sure?' },
        }),
      ]),
    ]);
    expect(q?.questions[0].question).toBe('Sure?');
  });
});

describe('openQuestion — prose fallback', () => {
  it('surfaces a settled assistant tail ending in a question', () => {
    const q = openQuestion([
      entry('e1', [text('t1', 'Analysis complete.\n\nProceed with deploy?')], {
        status: 'complete',
      }),
    ]);
    expect(q).toMatchObject({ kind: 'text', entryId: 'e1' });
    expect(q?.questions).toEqual([
      {
        id: 'q0',
        header: 'Agent question',
        question: 'Proceed with deploy?',
        options: [],
      },
    ]);
  });

  it('ignores questions mid-transcript and non-assistant tails', () => {
    const q = openQuestion([
      entry('e1', [text('t1', 'Want a change?')], { status: 'complete' }),
      { ...entry('u1', [text('t2', 'yes')], { role: 'user' }) },
    ]);
    expect(q).toBeUndefined();
  });

  it('ignores streaming and aborted tails', () => {
    expect(
      openQuestion([
        entry('e1', [text('t1', 'Continue?')], { status: 'streaming' }),
      ]),
    ).toBeUndefined();
    expect(
      openQuestion([
        entry('e1', [text('t1', 'Continue?')], { status: 'aborted' }),
      ]),
    ).toBeUndefined();
  });

  it('yields to an open tool call in the same entry', () => {
    const q = openQuestion([
      entry('e1', [
        tool('tc1', { kind: 'unknown', name: 'shell' }),
        text('t1', 'Continue?'),
      ]),
    ]);
    expect(q).toBeUndefined();
  });
});

describe('openQuestion — dismissal', () => {
  it('suppresses answered tool/text question ids', () => {
    const entries = [
      entry('e1', [tool('tc1', { kind: 'unknown', name: 'askQuestion' })]),
    ];
    expect(openQuestion(entries, new Set(['tc1']))).toBeUndefined();

    const prose = [
      entry('e1', [text('t1', 'Continue?')], { status: 'complete' }),
    ];
    expect(openQuestion(prose, new Set(['e1/q0']))).toBeUndefined();
  });
});

describe('formatQuestionAnswer', () => {
  it('matches the host respond_input_prompt shape', () => {
    const out = formatQuestionAnswer(
      [
        { id: 'a', header: 'h', question: 'Pick env?', options: [] },
        { id: 'b', header: 'h', question: '', options: [] },
      ],
      [
        { questionId: 'a', labels: ['staging', 'canary'] },
        { questionId: 'b', labels: ['free text'] },
      ],
    );
    expect(out).toBe(
      'Answering your earlier question:\nPick env? — staging, canary\nfree text',
    );
  });
});

describe('sameOpenQuestion', () => {
  const q = (body: string): OpenQuestion => ({
    kind: 'text',
    id: 'e1/q0',
    entryId: 'e1',
    questions: [
      { id: 'q0', header: 'Agent question', question: body, options: [] },
    ],
  });

  it('compares synthesized questions structurally', () => {
    expect(sameOpenQuestion(q('Go?'), q('Go?'))).toBe(true);
    expect(sameOpenQuestion(q('Go?'), q('Go ahead?'))).toBe(false);
    expect(sameOpenQuestion(q('Go?'), undefined)).toBe(false);
  });
});
