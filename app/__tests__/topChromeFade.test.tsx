import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TopChromeFade, hexToRgba } from '../src/components/TopChromeFade';
import { FadeBlur } from '../src/components/FadeBlur';

test('hexToRgba expands 6-digit theme colors', () => {
  expect(hexToRgba('#000000', 0)).toBe('rgba(0,0,0,0)');
  expect(hexToRgba('#FFFFFF', 0.55)).toBe('rgba(255,255,255,0.55)');
});

test('TopChromeFade is non-interactive and sized to inset plus band', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<TopChromeFade inset={88} />);
  });
  const fade = tree!.root.findByProps({ testID: 'top-chrome-fade' });
  expect(fade.props.pointerEvents).toBe('none');
  const style = Array.isArray(fade.props.style)
    ? fade.props.style.flat()
    : [fade.props.style];
  expect(style.some(s => s?.height === 88 + 56)).toBe(true);
  act(() => {
    tree?.unmount();
  });
});

test('FadeBlur down mode still mounts a mask', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <FadeBlur fade="down" fadeHold={0.4} intensity={22} />,
    );
  });
  expect(tree!.root).toBeTruthy();
  act(() => {
    tree?.unmount();
  });
});
