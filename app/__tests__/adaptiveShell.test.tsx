// AdaptiveShell in-flow sidebar: the uiPrefs toggle flips the persisted
// pref and the column's accessibilityState.expanded (regular width).
// Regular width also launches into the new-thread composer unless a
// requestedChat is already set.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Dimensions, Modal, StyleSheet } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { AdaptiveShell } from '../src/navigation/AdaptiveShell';
import {
  AppServicesContext,
  type AppServices,
} from '../src/app/runtimeContext';
import { setSidebarCollapsed, uiPrefsStore } from '../src/zeron/state/uiPrefs';
import { workspaceStore } from '../src/zeron/state/workspaceStore';
import { layoutFor } from '../src/navigation/layout';

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
  const expandedWidth = layoutFor(Dimensions.get('window').width, {
    sidebarCollapsed: false,
    inspectorOpen: false,
  }).sidebarWidth;
  let found = panel(tree.root);
  expect(found).toHaveLength(1);
  expect(found[0].props.accessibilityState.expanded).toBe(true);
  expect(found[0].props.pointerEvents).toBe('auto');
  const style = StyleSheet.flatten(found[0].props.style);
  expect(style.overflow).toBe('hidden');
  expect(style.position).toBe('absolute');
  const detail = StyleSheet.flatten(
    tree.root.findByProps({ testID: 'sessionDetail' }).props.style,
  );
  expect(detail.marginLeft).toBe(expandedWidth);

  act(() => setSidebarCollapsed(true));
  expect(uiPrefsStore.getState().sidebarCollapsed).toBe(true);
  found = panel(tree.root);
  expect(found[0].props.accessibilityState.expanded).toBe(false);
  expect(found[0].props.pointerEvents).toBe('none');
  expect(
    StyleSheet.flatten(
      tree.root.findByProps({ testID: 'sessionDetail' }).props.style,
    ).marginLeft,
  ).toBe(0);

  act(() => setSidebarCollapsed(false));
  found = panel(tree.root);
  expect(found[0].props.accessibilityState.expanded).toBe(true);
  expect(found[0].props.pointerEvents).toBe('auto');
  expect(
    StyleSheet.flatten(
      tree.root.findByProps({ testID: 'sessionDetail' }).props.style,
    ).marginLeft,
  ).toBe(expandedWidth);
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

test('sidebar inner fills the column with no horizontal padding', async () => {
  const tree = await render();
  const col = panel(tree.root)[0];
  const inner = col.children.find(
    (n): n is TestRenderer.ReactTestInstance =>
      typeof n !== 'string' && n != null && typeof n === 'object',
  ) as TestRenderer.ReactTestInstance;
  const style = StyleSheet.flatten(inner.props.style);
  expect(style.paddingHorizontal).toBeUndefined();
  await act(async () => {
    tree.unmount();
  });
});

test('compose sidebar toggle dismisses the keyboard', async () => {
  const tree = await render(null);
  const dismiss = KeyboardController.dismiss as jest.Mock;
  dismiss.mockClear();
  const toggle = tree.root.findAll(
    n =>
      n.props.accessibilityLabel === 'Toggle sidebar' &&
      typeof n.props.onPress === 'function',
  )[0];
  expect(toggle).toBeDefined();
  act(() => {
    toggle.props.onPress();
  });
  expect(dismiss).toHaveBeenCalled();
  expect(uiPrefsStore.getState().sidebarCollapsed).toBe(true);
  await act(async () => {
    tree.unmount();
  });
});
