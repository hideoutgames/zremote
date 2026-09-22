import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  getSessionStore,
  markQuestionAnswered,
  resetSessionStores,
  runPhase,
  useOpenInputRequest,
  useSessionCommands,
} from '../sessionStores';
import type {
  MessageEntry,
  MessagePart,
  SessionCommandEntry,
  SessionRow,
} from '../../protocol/types';

const entry = (id: string, text: string): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [{ kind: 'text', id: 't0', text }],
  createdAt: 1,
  deviceId: 'host',
});

const cmd = (id: string): SessionCommandEntry => ({
  id,
  kind: 'run',
  payload: { kind: 'run', request: {} as never, messageId: 'm' },
  issuedBy: 'phone',
  issuedAt: 1,
  status: 'pending',
});

const row = (status: SessionRow['status']): SessionRow => ({
  chatId: 'c',
  deviceId: 'host',
  status,
  updatedAt: 1_000,
});

let renders = 0;

const Probe = ({ chatId }: { chatId: string }) => {
  renders += 1;
  useOpenInputRequest(chatId);
  useSessionCommands(chatId);
  return null;
};

describe('session store selectors', () => {
  afterEach(() => {
    resetSessionStores();
  });

  it('do not re-render when only an unrelated entry text grows', () => {
    const chatId = 'c-sel';
    const commands = [cmd('c1')];
    getSessionStore(chatId).setState({
      entries: [entry('a', 'hi')],
      commands,
    });
    renders = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Probe chatId={chatId} />);
    });
    expect(renders).toBe(1);
    act(() => {
      getSessionStore(chatId).setState({
        entries: [entry('a', 'hello')],
        commands,
      });
    });
    expect(renders).toBe(1);
    act(() => {
      getSessionStore(chatId).setState({
        entries: [entry('a', 'hello')],
        commands: [cmd('c2')],
      });
    });
    expect(renders).toBe(2);
    act(() => {
      tree!.unmount();
    });
  });
});

// ── runPhase × question detection (detectQuestion.openQuestion) ─────────

const NOW = 2_000;

const toolPart = (id: string, name: string, resolved = false): MessagePart => ({
  kind: 'tool',
  id,
  call: { kind: 'unknown', name },
  resolved,
  ...(resolved ? { isError: false } : {}),
});

const questionToolEntry = (id: string, name = 'askQuestion'): MessageEntry => ({
  id,
  role: 'assistant',
  parts: [toolPart('tc1', name)],
  createdAt: 1,
  deviceId: 'host',
});

const state = (entries: MessageEntry[]) => ({
  ...getSessionStore('c').getState(),
  entries,
});

describe('runPhase with app-detected questions', () => {
  afterEach(() => {
    resetSessionStores();
  });

  it('unresolved question tool call on a live run → awaitingInput', () => {
    const s = state([questionToolEntry('e1')]);
    expect(runPhase(s, row('working'), undefined, 'phone', NOW)).toBe(
      'awaitingInput',
    );
  });

  it('resolved question tool → working', () => {
    const s = state([
      {
        id: 'e1',
        role: 'assistant',
        parts: [toolPart('tc1', 'askQuestion', true)],
        createdAt: 1,
        deviceId: 'host',
      },
    ]);
    expect(runPhase(s, row('working'), undefined, 'phone', NOW)).toBe(
      'working',
    );
  });

  it('dead run leaves the tool panel up but phase stays idle', () => {
    const s = state([questionToolEntry('e1')]);
    expect(runPhase(s, row('idle'), undefined, 'phone', NOW)).toBe('idle');
  });

  it('trailing prose question does not flip an idle session', () => {
    const s = state([
      {
        id: 'e1',
        role: 'assistant',
        parts: [{ kind: 'text', id: 't1', text: 'Done. Continue?' }],
        createdAt: 1,
        deviceId: 'host',
        status: 'complete',
      },
    ]);
    expect(runPhase(s, row('idle'), undefined, 'phone', NOW)).toBe('idle');
    // …but it marks the tail of a still-working run as awaiting input.
    expect(runPhase(s, row('working'), undefined, 'phone', NOW)).toBe(
      'awaitingInput',
    );
  });

  it('answered question ids stop blocking the phase', () => {
    const chatId = 'c';
    markQuestionAnswered(chatId, 'tc1');
    const s = {
      ...getSessionStore(chatId).getState(),
      entries: [questionToolEntry('e1')],
    };
    expect(runPhase(s, row('working'), undefined, 'phone', NOW)).toBe(
      'working',
    );
  });
});
