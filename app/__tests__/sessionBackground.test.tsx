import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SessionScreen } from '../src/screens/SessionScreen';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { workspaceStore } from '../src/zeron/state/workspaceStore';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

let tree: TestRenderer.ReactTestRenderer | undefined;

const render = async (element: React.ReactElement) => {
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        {element}
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

beforeEach(() => {
  uiPrefsStore.setState({
    newThreadComposerBackground: {
      uri: 'file:///docs/new-thread-backgrounds/x.png',
      name: 'sunset.png',
    },
    newThreadBackgroundEffect: 'none',
  });
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
});

test('compose session shows the new-thread hero and chrome fade', async () => {
  const mounted = await render(<SessionScreen onBack={() => {}} />);
  expect(
    mounted.root.findAll(n => n.props.testID === 'new-thread-background')
      .length,
  ).toBe(1);
  expect(
    mounted.root.findAll(n => n.props.testID === 'top-chrome-fade').length,
  ).toBe(1);
});

test('active session keeps the chrome fade and hides the hero', async () => {
  workspaceStore.setState({
    chats: [
      {
        id: 'c1',
        deviceId: 'host1',
        archived: false,
        createdAt: Date.now(),
        title: 'Live thread',
      },
    ],
  });
  const mounted = await render(<SessionScreen chatId="c1" onBack={() => {}} />);
  expect(
    mounted.root.findAll(n => n.props.testID === 'new-thread-background')
      .length,
  ).toBe(0);
  expect(
    mounted.root.findAll(n => n.props.testID === 'top-chrome-fade').length,
  ).toBe(1);
});
