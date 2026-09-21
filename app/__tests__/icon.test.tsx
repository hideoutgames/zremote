import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Icon } from '../src/components/Icon';

test('Icon renders expo-symbols at the requested size', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<Icon name="folder" size={18} color="#fff" />);
  });
  const wrap = tree!.root.findAll(
    n => n.props.style && Array.isArray(n.props.style),
  )[0];
  const style = wrap.props.style.flat();
  expect(style.some((s: { width?: number }) => s?.width === 18)).toBe(true);
  expect(style.some((s: { height?: number }) => s?.height === 18)).toBe(true);
  const symbol = tree!.root.findByProps({
    name: 'folder',
    resizeMode: 'scaleAspectFit',
  });
  expect(symbol.props.size).toBe(18);
  expect(symbol.props.tintColor).toBe('#fff');
  await act(async () => {
    tree?.unmount();
  });
});
