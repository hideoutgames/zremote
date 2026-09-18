// Smoke render: the app boots into SignInScreen when nothing is persisted.
// Renders the real root (App) so the provider tree is exercised too.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import App from '../App';
import { authStore } from '../src/zeron/state/authStore';

test('renders SignInScreen when signed out', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<App />);
    await Promise.resolve();
  });
  const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
  expect(texts).toContain('Sign in to ZRemote');
  expect(authStore.getState().status.state).toBe('signedOut');
});
