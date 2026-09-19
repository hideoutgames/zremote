// AdaptiveShell in-flow sidebar: the uiPrefs toggle flips the persisted
// pref and the glass panel's accessibilityState.expanded (regular width).

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
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

const render = async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <AppServicesContext.Provider value={services}>
        <AdaptiveShell requestedChat={null} />
      </AppServicesContext.Provider>,
    );
  });
  return tree!;
};

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
