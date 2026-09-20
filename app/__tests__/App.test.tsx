// Smoke render: the app boots into SignInScreen when nothing is persisted.
// Renders the real root (App) so the provider tree is exercised too.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import App from '../App';
import { authStore } from '../src/zeron/state/authStore';
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
  // Sign in is async (browser). Await the returned promise so paste UI
  // flushes inside act.
  await act(async () => {
    await target.props.onPress();
  });
};

const allText = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    return typeof c === 'string' ? [c] : [];
  });

const flattenStyle = (style: unknown): Record<string, unknown>[] => {
  if (style == null) return [];
  if (Array.isArray(style)) return style.flatMap(flattenStyle);
  if (typeof style === 'object') return [style as Record<string, unknown>];
  return [];
};

test('renders SignInScreen when signed out', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const texts = allText(tree!.root);
  expect(texts).toContain('Sign in');
  expect(texts).not.toContain('Sign in to ZRemote');
  expect(texts).not.toContain('state.code');
  expect(
    tree!.root.findAll(n => n.props.accessibilityLabel === 'ZRemote').length,
  ).toBeGreaterThan(0);
  expect(authStore.getState().status.state).toBe('signedOut');
  // Native splash must hide on this path — SessionScreen is not mounted.
  expect(
    tree!.root.findByProps({ testID: 'bootsplash-hide-on-draw' }),
  ).toBeTruthy();
  const signIn = tree!.root.findByProps({ accessibilityLabel: 'Sign in' });
  expect(flattenStyle(signIn.props.style).some(s => s.flex === 1)).toBe(false);
  await act(async () => {
    tree?.unmount();
  });
});

test('Sign in button does not flex-grow with the column', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  const signIn = tree!.root.findByProps({ accessibilityLabel: 'Sign in' });
  const signHit = flattenStyle(signIn.props.style);
  expect(signHit.some(s => s.flex === 1)).toBe(false);
  const wrapStyles = (node: TestRenderer.ReactTestInstance) => {
    const out: Record<string, unknown>[] = [];
    let cur: TestRenderer.ReactTestInstance | null = node;
    while (cur) {
      out.push(...flattenStyle(cur.props.style));
      cur = cur.parent;
    }
    return out;
  };
  expect(wrapStyles(signIn).some(s => s.flexGrow === 0)).toBe(true);
  expect(wrapStyles(signIn).some(s => s.alignSelf === 'center')).toBe(true);
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
  expect(
    tree!.root.findAll(n => n.props.accessibilityLabel === 'state.code').length,
  ).toBeGreaterThan(0);
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled();
  const [url, redirect, opts] = (WebBrowser.openAuthSessionAsync as jest.Mock)
    .mock.calls[0];
  expect(url).toContain(
    'https://api.workos.com/user_management/authorize?response_type=code',
  );
  expect(url).not.toContain('code_challenge');
  expect(redirect).toBe(AUTH_CALLBACK_URL);
  expect(opts).toEqual({
    preferEphemeralSession: false,
    preferUniversalLinks: false,
  });
  await act(async () => {
    tree!.unmount();
  });
});
