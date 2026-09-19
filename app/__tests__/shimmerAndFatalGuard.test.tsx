import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ShimmerText } from '../src/components/ShimmerText';
import { installJsFatalGuard } from '../src/zeron/native/jsFatalGuard';

test('ShimmerText renders the status label', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      <ShimmerText
        text="Working"
        width={140}
        fontSize={16}
        maxLines={1}
        align="left"
      />,
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('Working');
  act(() => {
    tree!.unmount();
  });
});

test('installJsFatalGuard replaces the JS handler', () => {
  const eu = (
    globalThis as typeof globalThis & {
      ErrorUtils: {
        getGlobalHandler(): (e: unknown, fatal?: boolean) => void;
        setGlobalHandler(cb: (e: unknown, fatal?: boolean) => void): void;
      };
    }
  ).ErrorUtils;
  const previous = eu.getGlobalHandler();
  installJsFatalGuard();
  expect(eu.getGlobalHandler()).not.toBe(previous);
  eu.setGlobalHandler(previous);
});
