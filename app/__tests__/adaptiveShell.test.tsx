// AdaptiveShell in-flow sidebar: the uiPrefs toggle flips the persisted
// pref and the column's accessibilityState.expanded (regular width).
// Regular width also launches into the new-thread composer unless a
// requestedChat is already set.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import { AdaptiveShell } from '../src/navigation/AdaptiveShell';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { setSidebarCollapsed, uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { workspaceStore } from '../src/zeron/state/workspaceStore';

const services: AppServices = {
  auth: null as never,
  runtime: null,
  openSession: () => {},
  signOut: async () => {},
};

const render = async (requestedChat: string | null = null) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        <AdaptiveShell requestedChat={requestedChat} />
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

const panel = (root: TestRenderer.ReactTestInstance) =>
  root.findAll(
    n => n.props.testID === 'threadsSidebar' && typeof n.type === 'string',
  );

beforeEach(() => {
  setSidebarCollapsed(false);
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
  setSidebarCollapsed(false);
});

test('sidebar panel renders expanded; collapse flips pref + state', async () => {
  // Requires regular width (≥700pt): the test env window is 750pt.
  const tree = await render();
  let found = panel(tree.root);
  expect(found).toHaveLength(1);
  expect(found[0].props.accessibilityState.expanded).toBe(true);
  expect(found[0].props.pointerEvents).toBe('auto');
  const style = Array.isArray(found[0].props.style)
    ? found[0].props.style.flat()
    : [found[0].props.style];
  expect(style.some(s => s?.overflow === 'hidden')).toBe(true);
  expect(style.some(s => s?.position === 'absolute')).toBe(false);

  act(() => setSidebarCollapsed(true));
  expect(uiPrefsStore.getState().sidebarCollapsed).toBe(true);
  found = panel(tree.root);
  expect(found[0].props.accessibilityState.expanded).toBe(false);
  expect(found[0].props.pointerEvents).toBe('none');

  act(() => setSidebarCollapsed(false));
  found = panel(tree.root);
  expect(found[0].props.accessibilityState.expanded).toBe(true);
  expect(found[0].props.pointerEvents).toBe('auto');
  await act(async () => {
    tree.unmount();
  });
});

test('regular-width Settings Modal allows swipe / outside dismiss', async () => {
  const tree = await render();
  const modal = tree.root.findByType(Modal);
  expect(modal.props.presentationStyle).toBe('formSheet');
  expect(modal.props.allowSwipeDismissal).toBe(true);
  expect(typeof modal.props.onRequestClose).toBe('function');
  await act(async () => {
    tree.unmount();
  });
});

test('regular width launches into the new-thread composer', async () => {
  const tree = await render(null);
  expect(
    tree.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBeGreaterThan(0);
  expect(
    tree.root.findAll(n => n.props.testID === 'session-title-pill').length,
  ).toBe(0);
  expect(texts(tree.root)).not.toContain(
    'Nothing here yet — send a message to start.',
  );
  await act(async () => {
    tree.unmount();
  });
});

test('regular width with requestedChat opens that session, not compose', async () => {
  workspaceStore.setState({
    devices: [],
    spaces: [],
    chats: [
      {
        id: 'c1',
        deviceId: 'h1',
        archived: false,
        createdAt: 1,
        title: 'Live thread',
      },
    ],
    sessions: {},
    presence: {},
    connection: 'connected',
    lastSyncAt: undefined,
  });
  const tree = await render('c1');
  expect(
    tree.root.findAll(n => n.props.testID === 'compose-composer').length,
  ).toBe(0);
  expect(
    tree.root.findAll(n => n.props.testID === 'session-title-pill').length,
  ).toBeGreaterThan(0);
  await act(async () => {
    tree.unmount();
  });
});
