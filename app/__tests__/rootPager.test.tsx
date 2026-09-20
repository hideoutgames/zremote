// Compact Home ↔ Session pager: back must keep chat/compose mounted until
// PagerView reports Home. Freeze is a Jest passthrough, so this asserts
// composing teardown (and that a real session stays mounted after settle).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RootPager } from '../src/screens/RootPager';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { workspaceStore } from '../src/zeron/state/workspaceStore';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const render = async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        <RootPager requestedChat={null} />
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

const count = (root: TestRenderer.ReactTestInstance, testID: string): number =>
  root.findAll(n => n.props.testID === testID).length;

const pressBack = async (root: TestRenderer.ReactTestInstance) => {
  const back = root.findAll(
    n =>
      n.props.accessibilityLabel === 'Back' &&
      typeof n.props.onPress === 'function',
  )[0];
  expect(back).toBeDefined();
  await act(async () => {
    back.props.onPress();
  });
};

const settleHome = async (root: TestRenderer.ReactTestInstance) => {
  const pager = root.findAll(
    n => typeof n.props.onPageSelected === 'function',
  )[0];
  expect(pager).toBeDefined();
  await act(async () => {
    pager.props.onPageSelected({ nativeEvent: { position: 0 } });
  });
};

beforeEach(() => {
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

test('compose stays mounted until the pager settles on Home', async () => {
  const tree = await render();
  const btn = tree.root.findAll(n => n.props.testID === 'home-new-thread')[0];
  expect(btn).toBeDefined();
  await act(async () => {
    btn.props.onPress();
  });
  expect(count(tree.root, 'compose-composer')).toBeGreaterThan(0);

  await pressBack(tree.root);
  expect(count(tree.root, 'compose-composer')).toBeGreaterThan(0);

  await settleHome(tree.root);
  expect(count(tree.root, 'compose-composer')).toBe(0);

  await act(async () => {
    tree.unmount();
  });
});

test('open session stays mounted through back and after Home settles', async () => {
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
  const tree = await render();
  const row = tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.includes('Live thread') &&
      typeof n.props.onPress === 'function',
  )[0];
  expect(row).toBeDefined();
  await act(async () => {
    row.props.onPress();
  });
  expect(count(tree.root, 'session-composer')).toBeGreaterThan(0);

  await pressBack(tree.root);
  expect(count(tree.root, 'session-composer')).toBeGreaterThan(0);

  await settleHome(tree.root);
  expect(count(tree.root, 'session-composer')).toBeGreaterThan(0);

  await act(async () => {
    tree.unmount();
  });
});
