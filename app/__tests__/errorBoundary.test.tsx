import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AppErrorBoundary } from '../src/app/AppErrorBoundary';

const Boom = ({ fail }: { fail: boolean }) => {
  if (fail) throw new Error('render boom');
  return <Text>ok</Text>;
};

test('render throw becomes retry fallback instead of escaping', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      <AppErrorBoundary>
        <Boom fail />
      </AppErrorBoundary>,
    );
  });
  expect(tree!.root.findByProps({ testID: 'app-error-fallback' })).toBeTruthy();
  const retry = tree!.root
    .findAll(n => typeof n.props.onPress === 'function')
    .find(p =>
      p.findAllByType(Text).some(tn => tn.props.children === 'Try again'),
    );
  expect(retry).toBeDefined();
  spy.mockRestore();
});

test('resetKey remounts children after an error', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      <AppErrorBoundary resetKey="a">
        <Boom fail />
      </AppErrorBoundary>,
    );
  });
  act(() => {
    tree!.update(
      <AppErrorBoundary resetKey="b">
        <Boom fail={false} />
      </AppErrorBoundary>,
    );
  });
  const texts = tree!.root
    .findAllByType(Text)
    .flatMap(n =>
      typeof n.props.children === 'string' ? [n.props.children] : [],
    );
  expect(texts).toContain('ok');
  spy.mockRestore();
});
