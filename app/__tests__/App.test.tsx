// Smoke render: the app boots into SignInScreen when nothing is persisted.
// Renders the real root (App) so the provider tree is exercised too. The
// second test enters demo mode through the real sign-in UI and lands on Home
// driven by the simulated edge.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import App from '../App';
import { authStore } from '../src/zeron/state/authStore';
import { exitDemo } from '../src/demo/demoMode';
import { AUTH_CALLBACK_URL } from '../src/zeron/native/authBrowser';

const pressByText = async (
  root: TestRenderer.ReactTestInstance,
  label: string,
): Promise<void> => {
  // findAllByType(Pressable) misses under the RN jest preset (the preset's
  // Pressable is a different module instance) — match any element with an
  // onPress whose subtree carries the label.
  const target = root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(p => p.findAllByType(Text).some(tn => tn.props.children === label));
  if (target === undefined) throw new Error(`no pressable for ${label}`);
  // Sign in / Try demo are async (PKCE + browser). Await the returned
  // promise so paste UI and demo bootstrap flush inside act.
  await act(async () => {
    await target.props.onPress();
  });
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
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const texts = allText(tree!.root);
  expect(texts).toContain('Sign in to ZRemote');
  expect(texts).not.toContain('Paste the sign-in code');
  expect(authStore.getState().status.state).toBe('signedOut');
  // Native splash must hide on this path — SessionScreen is not mounted.
  expect(
    tree!.root.findByProps({ testID: 'bootsplash-hide-on-draw' }),
  ).toBeTruthy();
  await act(async () => {
    tree!.unmount();
  });
});

test('Sign in opens WorkOS via a zeron:// auth session and shows paste fallback when it cancels', async () => {
  (WebBrowser.openAuthSessionAsync as jest.Mock).mockClear();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  await pressByText(tree!.root, 'Sign in');
  const texts = allText(tree!.root);
  expect(texts).toContain('Paste the sign-in code');
  expect(
    tree!.root.findAll(n => n.props.accessibilityLabel === 'state.code').length,
  ).toBeGreaterThan(0);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled();
  const [url, redirect, opts] = (WebBrowser.openAuthSessionAsync as jest.Mock)
    .mock.calls[0];
  expect(url).toContain(
    'https://api.workos.com/user_management/authorize?response_type=code',
  );
  expect(redirect).toBe(AUTH_CALLBACK_URL);
  expect(opts).toEqual({
    preferEphemeralSession: false,
    preferUniversalLinks: false,
  });
  await act(async () => {
    tree!.unmount();
  });
});

test('Advanced → Try demo mode lands on Home with fixture data', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    // Let auth.restore() settle to signedOut before entering demo.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  await pressByText(tree!.root, 'Advanced');
  await pressByText(tree!.root, 'Try demo mode');
  // Runtime create + registry dial run on microtasks only.
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
  const texts = allText(tree!.root);
  expect(texts).not.toContain('Demo');
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

test('demo: opening a working thread does not show the error fallback', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = TestRenderer.create(<App />);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await pressByText(tree!.root, 'Advanced');
    await pressByText(tree!.root, 'Try demo mode');
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    await pressByText(tree!.root, 'Ship demo mode');
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(
      tree!.root.findAll(n => n.props.testID === 'app-error-fallback'),
    ).toHaveLength(0);
  } finally {
    await act(async () => {
      exitDemo();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      tree?.unmount();
    });
  }
});
