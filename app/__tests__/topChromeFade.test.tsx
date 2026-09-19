import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  TopChromeFade,
  hexToRgba,
  TOP_CHROME_BLUR_INTENSITY,
} from '../src/components/TopChromeFade';
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
  const blur = tree!.root.findAll(n => n.props.intensity != null)[0];
  expect(blur.props.intensity).toBe(TOP_CHROME_BLUR_INTENSITY);
  const wash = tree!.root.findAll(
    n => Array.isArray(n.props.colors) && n.props.colors.length === 4,
  )[0];
  expect(wash.props.colors[0]).toMatch(/rgba\(\d+,\d+,\d+,0\.12\)$/);
  expect(wash.props.colors[2]).toMatch(/rgba\(\d+,\d+,\d+,0\.06\)$/);
  act(() => {
    tree?.unmount();
  });
});

test('FadeBlur horizontal mode still mounts a mask', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <FadeBlur fade="horizontal" fadeHold={0.14} intensity={36} />,
    );
  });
  expect(tree!.root).toBeTruthy();
  act(() => {
    tree?.unmount();
  });
});

test('FadeBlur none mode still mounts a blur', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<FadeBlur fade="none" intensity={80} />);
  });
  expect(tree!.root.findByProps({ intensity: 80 })).toBeTruthy();
  act(() => {
    tree?.unmount();
  });
});
