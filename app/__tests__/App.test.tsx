// Smoke render: the app boots into SignInScreen when nothing is persisted.
// Renders the real root (App) so the provider tree is exercised too. The
// second test enters demo mode through the real sign-in UI and lands on Home
// driven by the simulated edge.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import App from '../App';
import { authStore } from '../src/zeron/state/authStore';
import { exitDemo } from '../src/demo/demoMode';

const pressByText = (
  root: TestRenderer.ReactTestInstance,
  label: string,
): void => {
  // findAllByType(Pressable) misses under the RN jest preset (the preset's
  // Pressable is a different module instance) — match any element with an
  // onPress whose subtree carries the label.
  const target = root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(p => p.findAllByType(Text).some(tn => tn.props.children === label));
  if (target === undefined) throw new Error(`no pressable for ${label}`);
  act(() => target.props.onPress());
};

const allText = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return typeof c === 'string' ? [c] : [];
  });

test('renders SignInScreen when signed out', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    await Promise.resolve();
  });
  const texts = allText(tree!.root);
  expect(texts).toContain('Sign in to ZRemote');
  expect(authStore.getState().status.state).toBe('signedOut');
  // Native splash must hide on this path — SessionScreen is not mounted.
  expect(
    tree!.root.findByProps({ testID: 'bootsplash-hide-on-draw' }),
  ).toBeTruthy();
  await act(async () => {
    tree!.unmount();
  });
});

test('Advanced → Try demo mode lands on Home with fixture data + badge', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    // Let auth.restore() settle to signedOut before entering demo.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  pressByText(tree!.root, 'Advanced');
  pressByText(tree!.root, 'Try demo mode');
  // Runtime create + registry dial run on microtasks only.
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  const texts = allText(tree!.root);
  expect(texts).toContain('Demo');
  expect(texts).toContain('Ship demo mode');
  expect(texts).toContain('Refactor relay reconnect');
  await act(async () => {
    exitDemo();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  await act(async () => {
    tree!.unmount();
  });
});
