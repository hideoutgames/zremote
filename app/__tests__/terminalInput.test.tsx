import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { SessionScreen } from '../src/screens/SessionScreen';
import { TerminalScreen } from '../src/screens/TerminalScreen';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { getSessionStore } from '../src/zeron/state/sessionStores';
import { changeRequestStore } from '../src/zeron/state/changeRequestStore';
import {
  resetTerminalTabsForTests,
  saveTerminalTabs,
} from '../src/zeron/terminal/sessions';
import { AnsiScreen } from '../src/zeron/terminal/ansi';
import type { TerminalClient } from '../src/zeron/terminal/client';
import type { Chat, DeviceRow } from '../src/zeron/protocol/types';

const mockFocusInput = jest.fn();
const mockOnFocus = jest.fn();
const mockOnBlur = jest.fn();
jest.mock('../src/zeron/terminal/focus', () => ({
  createTerminalFocus: () => ({
    focusInput: mockFocusInput,
    onFocus: mockOnFocus,
    onBlur: mockOnBlur,
    isFocused: () => false,
    dispose: jest.fn(),
  }),
}));

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const chat: Chat = {
  id: 'c1',
  deviceId: 'h1',
  title: 'Demo thread',
  archived: false,
  createdAt: 1_700_000_000_000,
};

const device: DeviceRow = {
  id: 'h1',
  name: 'workstation',
  platform: 'macos',
  capabilities: [],
  version: '0.2.72',
};

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

beforeEach(() => {
  mockFocusInput.mockClear();
  mockOnFocus.mockClear();
  mockOnBlur.mockClear();
  resetTerminalTabsForTests();
  act(() => {
    workspaceStore.setState({
      devices: [device],
      spaces: [],
      chats: [chat],
      sessions: {},
      presence: {},
      connection: 'connected',
      lastSyncAt: undefined,
    });
    changeRequestStore.setState({ byChat: {}, diffByChat: {} });
    getSessionStore('c1').setState({
      entries: [],
      commands: [],
      queue: [],
      meta: {},
      pendingSends: [],
      failedSends: [],
      unsyncedCommandIds: [],
      room: 'idle',
      queueActionsPending: new Set(),
    });
  });
});

const trees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  trees.push(tree!);
  return tree!;
};

afterEach(() => {
  act(() => {
    for (const tree of trees) tree.unmount();
    trees.length = 0;
  });
  resetTerminalTabsForTests();
});

const stubTab = (input: (bytes: Uint8Array) => void) => {
  const tab = {
    client: {
      handle: {
        session: { id: 't1', cwd: '/repo', shell: 'zsh' },
        lastSeq: 0,
        exited: false,
      },
      input,
      subscribe: jest.fn(() => Promise.resolve()),
      resize: jest.fn(),
      detach: jest.fn(),
      close: jest.fn(),
    } as unknown as TerminalClient,
    screen: new AnsiScreen(8, 4),
    exited: false,
  };
  saveTerminalTabs('c1', [tab]);
  return tab;
};

test('hidden terminal input stays focused after submit and can raise the keyboard', async () => {
  const tree = await render(<TerminalScreen chatId="c1" />);
  const input = tree.root.findByProps({ testID: 'terminal-input' });
  expect(input.props.autoFocus).toBe(false);
  expect(input.props.blurOnSubmit).toBe(false);
  expect(input.props.caretHidden).toBe(true);
  expect(input.props.showSoftInputOnFocus).toBe(true);
  expect(input.props.spellCheck).toBe(false);
  expect(input.props.autoComplete).toBe('off');
  expect(input.props.keyboardAppearance).toBe('dark');
  const style = StyleSheet.flatten(input.props.style);
  expect(style.opacity).toBeGreaterThan(0);
  expect(style.width).toBeGreaterThan(1);
  expect(style.height).toBeGreaterThan(1);
});

test('screen layout, list touch, and key bar focus the hidden input', async () => {
  const tree = await render(<TerminalScreen chatId="c1" />);
  const input = tree.root.findByProps({ testID: 'terminal-input' });
  expect(input.props.onFocus).toBe(mockOnFocus);
  expect(input.props.onBlur).toBe(mockOnBlur);

  const screen = tree.root.findByProps({ testID: 'terminal-screen' });
  const list = tree.root.findByProps({ testID: 'terminal-list' });
  expect(list.props.keyboardShouldPersistTaps).toBe('always');
  expect(list.props.keyboardDismissMode).toBe('none');
  expect(list.props.onTouchEnd).toBe(mockFocusInput);

  mockFocusInput.mockClear();
  await act(async () => {
    screen.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } },
    });
  });
  expect(mockFocusInput).toHaveBeenCalled();
  mockFocusInput.mockClear();

  await act(async () => {
    list.props.onTouchEnd();
  });
  expect(mockFocusInput).toHaveBeenCalled();
  mockFocusInput.mockClear();

  const esc = tree.root.findAll(
    n =>
      n.props.accessibilityLabel === 'ESC' &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => {
    esc.props.onPress();
  });
  expect(mockFocusInput).toHaveBeenCalled();
});

test('typing and Enter send bytes to the active tab', async () => {
  const received: number[][] = [];
  stubTab(bytes => received.push([...bytes]));
  const tree = await render(<TerminalScreen chatId="c1" />);
  const input = tree.root.findByProps({ testID: 'terminal-input' });
  await act(async () => {
    input.props.onChangeText('hi');
    input.props.onKeyPress({ nativeEvent: { key: 'Enter' } });
  });
  expect(received).toEqual([[104, 105], [0x0d]]);
});

test('opening Terminal dismisses the composer keyboard', async () => {
  const tree = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  const dismiss = KeyboardController.dismiss as jest.Mock;
  dismiss.mockClear();
  const item = tree.root
    .findAll(n => n.props.testID === 'DropdownItem')
    .find(n => texts(n).includes('Terminal'));
  expect(item).toBeTruthy();
  await act(async () => {
    item!.props.onSelect();
  });
  expect(dismiss).toHaveBeenCalled();
  expect(
    tree.root.findAll(n => n.props.testID === 'session-sheet').length,
  ).toBeGreaterThan(0);
});
