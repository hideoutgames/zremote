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
  isError = false,
): MessagePart => ({
  kind: 'tool',
  id,
  call: call as RenderToolCall,
  resolved,
  ...(resolved ? { isError } : {}),
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
      {
        id: 'q0',
        header: 'Agent question',
        question: 'The agent needs your input',
        options: [],
      },
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

  it('covers the supported harnesses’ ask-user tools', () => {
    // claude-code · codex · cursor · opencode · hermes · pi · grok ·
    // generic spellings — all name-only, all must surface a question.
    for (const name of [
      'AskUserQuestion', // claude-code
      'ask_user_question', // codex variant / grok method leaf
      'request_user_input', // codex
      'AskQuestion', // cursor
      'ask_question', // pi
      'question', // opencode
      'clarify', // hermes
      'ask_user',
      'user_input',
      'user_question',
      'ask_human',
      'human_input',
      'get_user_input',
      'prompt_user',
      'query_user',
      'elicitInput',
    ]) {
      const q = openQuestion([
        entry('e1', [tool('tc', { kind: 'unknown', name })]),
      ]);
      expect(q?.kind).toBe('tool');
    }
  });

  it('strips vendor/namespace prefixes from method-style names', () => {
    for (const name of [
      'cursor/ask_question',
      'x.ai/ask_user_question',
      '_x.ai/ask_user_question',
      'mcp__srv__ask_user_question',
      'mcp__srv__askQuestion',
    ]) {
      const q = openQuestion([
        entry('e1', [tool('tc', { kind: 'unknown', name })]),
      ]);
      expect(q?.kind).toBe('tool');
    }
  });

  it('reads the tool name from the doc kind when no name field exists', () => {
    const q = openQuestion([
      entry('e1', [tool('tc', { kind: 'AskUserQuestion' })]),
    ]);
    expect(q?.kind).toBe('tool');
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

  it('parses the Cursor AskQuestion shape, including JSON-string args', () => {
    const args = {
      title: 'Need input',
      questions: [
        {
          id: 'mode',
          prompt: 'Which mode should I use?',
          options: [
            { id: 'agent', label: 'Agent' },
            { id: 'plan', label: 'Plan' },
          ],
          allow_multiple: false,
        },
        {
          id: 'aspects',
          prompt: 'Which aspects should vary?',
          options: [
            { id: 'a', label: 'Color' },
            { id: 'b', label: 'Type' },
          ],
          allow_multiple: true,
        },
      ],
    };
    const q = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'AskQuestion',
          arguments: JSON.stringify(args),
        }),
      ]),
    ]);
    expect(q?.questions).toEqual([
      {
        id: 'mode',
        header: 'Need input',
        question: 'Which mode should I use?',
        options: ['Agent', 'Plan'],
      },
      {
        id: 'aspects',
        header: 'Need input',
        question: 'Which aspects should vary?',
        options: ['Color', 'Type'],
        multiSelect: true,
      },
    ]);
  });

  it('matches SDK discriminants like askQuestionToolCall', () => {
    const q = openQuestion([
      entry('e1', [
        tool('tc', { kind: 'unknown', name: 'askQuestionToolCall' }),
      ]),
    ]);
    expect(q?.kind).toBe('tool');
  });

  it('reads a bare string prompt and a JSON question list', () => {
    const bare = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'AskQuestion',
          input: 'Which environment?',
        }),
      ]),
    ]);
    expect(bare?.questions[0].question).toBe('Which environment?');

    const list = openQuestion([
      entry('e1', [
        tool('tc1', {
          kind: 'unknown',
          name: 'AskQuestion',
          arguments: JSON.stringify([
            { prompt: 'Which environment?' },
            { prompt: 'Roll back on failure?' },
          ]),
        }),
      ]),
    ]);
    expect(list?.questions.map(item => item.question)).toEqual([
      'Which environment?',
      'Roll back on failure?',
    ]);
  });

  it('uses a sibling question when the host stripped the tool args', () => {
    const q = openQuestion([
      entry('e1', [
        text('t1', 'I can do this two ways.\n\nWhich environment?'),
        tool('tc1', { kind: 'unknown', name: 'askQuestion' }),
      ]),
    ]);
    expect(q?.kind).toBe('tool');
    expect(q?.questions[0].question).toBe('Which environment?');
  });

  it('keeps a failed or skipped AskQuestion that ended the turn', () => {
    const failed = openQuestion([
      entry('e1', [
        tool('tc1', { kind: 'unknown', name: 'AskQuestion' }, true, true),
      ]),
    ]);
    expect(failed?.kind).toBe('tool');

    const skipped = openQuestion([
      entry('e1', [
        {
          kind: 'tool',
          id: 'tc2',
          call: { kind: 'unknown', name: 'askQuestion' },
          resolved: true,
          isError: false,
          output:
            'Questions skipped by the user, continue with the information you already have',
        },
      ]),
    ]);
    expect(skipped?.kind).toBe('tool');
  });

  it('does not reopen a skipped question once a later entry continues', () => {
    expect(
      openQuestion([
        entry('e1', [
          {
            kind: 'tool',
            id: 'tc1',
            call: { kind: 'unknown', name: 'askQuestion' },
            resolved: true,
            isError: false,
            output: 'Questions skipped by the user',
          },
        ]),
        entry('e2', [text('t1', 'Using the default and continuing.')], {
          status: 'complete',
        }),
      ]),
    ).toBeUndefined();
  });

  it('keeps a skipped question whose prompt survived in a later message', () => {
    const q = openQuestion([
      entry('e1', [
        {
          kind: 'tool',
          id: 'tc1',
          call: { kind: 'unknown', name: 'askQuestion' },
          resolved: true,
          isError: false,
          output: 'Questions skipped by the user',
        },
      ]),
      entry('e2', [text('t1', 'Which environment?')], { status: 'complete' }),
    ]);
    expect(q?.kind).toBe('tool');
    expect(q?.questions[0].question).toBe('Which environment?');
  });

  it('does not reopen a question the agent already continued past', () => {
    expect(
      openQuestion([
        entry('e1', [
          tool('tc1', { kind: 'unknown', name: 'AskQuestion' }, true, true),
          text('t1', 'I will use the default and keep going.'),
        ]),
      ]),
    ).toBeUndefined();
  });

  it('ignores a question tool once the user has replied', () => {
    expect(
      openQuestion([
        entry('e1', [tool('tc1', { kind: 'unknown', name: 'askQuestion' })]),
        { ...entry('u1', [text('t2', 'staging')], { role: 'user' }) },
      ]),
    ).toBeUndefined();
  });

  it('does not treat another tool that merely shares a name as a question', () => {
    expect(
      openQuestion([
        entry('e1', [
          tool('tc1', {
            kind: 'unknown',
            name: 'question',
            args: { command: 'ls' },
          }),
        ]),
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

  it('still asks when a settled entry ends on a question beside an open tool', () => {
    const q = openQuestion([
      entry(
        'e1',
        [
          tool('tc1', { kind: 'unknown', name: 'shell' }),
          text('t1', 'Continue?'),
        ],
        { status: 'complete' },
      ),
    ]);
    expect(q?.kind).toBe('text');
    expect(q?.questions[0].question).toBe('Continue?');
  });

  it('ignores a question the agent already answered later in the message', () => {
    expect(
      openQuestion([
        entry(
          'e1',
          [
            text(
              't1',
              'Should I refactor?\n\nI went ahead and renamed the module.',
            ),
          ],
          { status: 'complete' },
        ),
      ]),
    ).toBeUndefined();
  });

  it('ignores question marks inside code, links, and earlier paragraphs', () => {
    expect(
      openQuestion([
        entry(
          'e1',
          [
            text(
              't1',
              'Use `user?.name`.\n\n```\nconst x = a?.b ?? c;\n```\n\nSee https://example.com/a?q=1\n\nShipped.',
            ),
          ],
          { status: 'complete' },
        ),
      ]),
    ).toBeUndefined();
    expect(
      openQuestion([
        entry(
          'e1',
          [
            text(
              't1',
              'What changed?\n\n- src/app.ts\n- src/index.ts\n\nDone.',
            ),
          ],
          { status: 'complete' },
        ),
      ]),
    ).toBeUndefined();
  });

  it('reads lettered choices and a list glued to its question', () => {
    const lettered = openQuestion([
      entry(
        'e1',
        [text('t1', 'Which environment?\n\nA) staging\nB) production')],
        { status: 'complete' },
      ),
    ]);
    expect(lettered?.questions[0].options).toEqual(['staging', 'production']);

    const glued = openQuestion([
      entry('e1', [text('t1', 'Which environment?\n- staging\n- production')], {
        status: 'complete',
      }),
    ]);
    expect(glued?.questions[0].question).toBe('Which environment?');
    expect(glued?.questions[0].options).toEqual(['staging', 'production']);
  });

  it('reads a trailing choice list as options', () => {
    const q = openQuestion([
      entry(
        'e1',
        [text('t1', 'Which environment?\n\n- staging\n- production')],
        { status: 'complete' },
      ),
    ]);
    expect(q?.questions).toEqual([
      {
        id: 'q0',
        header: 'Agent question',
        question: 'Which environment?',
        options: ['staging', 'production'],
      },
    ]);
  });

  it('splits a trailing list of questions', () => {
    const q = openQuestion([
      entry(
        'e1',
        [text('t1', '1. Which environment?\n2. Roll back on failure?')],
        { status: 'complete' },
      ),
    ]);
    expect(q?.questions.map(item => item.question)).toEqual([
      'Which environment?',
      'Roll back on failure?',
    ]);
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
