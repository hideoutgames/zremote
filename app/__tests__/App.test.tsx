// Smoke render: the app boots into SignInScreen when nothing is persisted.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ZeronApp } from '../src/app/ZeronApp';
import { authStore } from '../src/zeron/state/authStore';

test('renders SignInScreen when signed out', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<ZeronApp />);
    await Promise.resolve();
  });
  const texts = tree!.root.findAllByType(Text).map(n => n.props.children);
  expect(texts).toContain('Sign in to Zeron');
  expect(authStore.getState().status.state).toBe('signedOut');
});
