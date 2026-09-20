import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  getSessionStore,
  resetSessionStores,
  useOpenInputRequest,
  useSessionCommands,
} from '../sessionStores';
import type { MessageEntry, SessionCommandEntry } from '../../protocol/types';

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
