import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Icon, ICON_OPTICAL_PAD } from '../src/components/Icon';

test('Icon clip box is larger than the glyph point size', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<Icon name="folder" size={18} color="#fff" />);
  });
  const box = 18 + ICON_OPTICAL_PAD * 2;
  const wrap = tree!.root.findAll(
    n => n.props.style && Array.isArray(n.props.style),
  )[0];
  const style = wrap.props.style.flat();
  expect(style.some((s: { width?: number }) => s?.width === box)).toBe(true);
  expect(style.some((s: { height?: number }) => s?.height === box)).toBe(true);
  const symbol = tree!.root.findByProps({ symbolName: 'folder' });
  expect(symbol.props.pointSize).toBe(18);
  await act(async () => {
    tree?.unmount();
  });
});
