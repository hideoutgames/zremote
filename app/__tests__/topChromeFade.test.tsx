import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  TopChromeFade,
  ChromeFade,
  maskStopsFor,
  composerMaskBottomInset,
  TOP_CHROME_BLUR_INTENSITY,
  TOP_CHROME_FADE_BAND,
  COMPOSER_BOTTOM_FADE_BAND,
  COMPOSER_BELOW_PAD,
  CHROME_FADE_WASH_DARK,
  CHAT_TOP_FADE_BAND,
} from '../src/components/TopChromeFade';
import { FadeBlur } from '../src/components/FadeBlur';

const flattenStyle = (style: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(style) ? style.flat() : [style];
  return list.filter(
    (s): s is Record<string, unknown> => s != null && typeof s === 'object',
  );
};

test('TopChromeFade is non-interactive and sized to inset plus band', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<TopChromeFade inset={88} />);
  });
  const fade = tree!.root.findByProps({ testID: 'top-chrome-fade' });
  expect(fade.props.pointerEvents).toBe('none');
  expect(flattenStyle(fade.props.style).some(s => s.height === 88 + 56)).toBe(
    true,
  );
  const blur = tree!.root.findAll(n => n.props.intensity != null)[0];
  expect(blur.props.intensity).toBe(TOP_CHROME_BLUR_INTENSITY);
  expect(
    tree!.root.findAll(n => n.props.testID === 'chrome-fade-wash'),
  ).toHaveLength(0);
  await act(async () => {
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
  await act(async () => {
    tree?.unmount();
  });
});

test('ChromeFade bottom sizes the plateau to the composer inset', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <ChromeFade
        edge="bottom"
        inset={120}
        fadeBand={COMPOSER_BOTTOM_FADE_BAND}
      />,
    );
  });
  const fade = tree!.root.findByProps({ testID: 'bottom-chrome-fade' });
  const style = flattenStyle(fade.props.style);
  expect(style.some(s => s.height === 120 + COMPOSER_BOTTOM_FADE_BAND)).toBe(
    true,
  );
  expect(style.some(s => s.bottom === 0)).toBe(true);
  await act(async () => {
    tree?.unmount();
  });
});

test('Home-style bottom fade is the 56pt band at the screen bottom', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <ChromeFade edge="bottom" inset={0} fadeBand={TOP_CHROME_FADE_BAND} />,
    );
  });
  const fade = tree!.root.findByProps({ testID: 'bottom-chrome-fade' });
  const style = flattenStyle(fade.props.style);
  expect(style.some(s => s.height === TOP_CHROME_FADE_BAND)).toBe(true);
  expect(style.some(s => s.bottom === 0)).toBe(true);
  expect(style.some(s => typeof s.bottom === 'number' && s.bottom > 0)).toBe(
    false,
  );
  await act(async () => {
    tree?.unmount();
  });
});

test('wash paints a black gradient over the fade', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <ChromeFade
        edge="bottom"
        inset={0}
        fadeBand={TOP_CHROME_FADE_BAND}
        wash={CHROME_FADE_WASH_DARK}
        tint="systemThinMaterialDark"
      />,
    );
  });
  const wash = tree!.root.findByProps({ testID: 'chrome-fade-wash' });
  expect(wash.props.colors).toContain(CHROME_FADE_WASH_DARK);
  expect(wash.props.colors.every((c: string) => c !== '#FFFFFF')).toBe(true);
  const blur = tree!.root.findAll(n => n.props.intensity != null)[0];
  expect(blur.props.tint).toBe('systemThinMaterialDark');
  await act(async () => {
    tree?.unmount();
  });
});

test('CHAT_TOP_FADE_BAND is half the session header chrome band', () => {
  expect(CHAT_TOP_FADE_BAND).toBe(TOP_CHROME_FADE_BAND / 2);
  expect(CHAT_TOP_FADE_BAND).toBe(28);
});

test('composerMaskBottomInset uses the pad below the glass, not composer height', () => {
  expect(COMPOSER_BELOW_PAD).toBe(8);
  expect(composerMaskBottomInset(0, 34)).toBe(42);
  expect(composerMaskBottomInset(336, 34)).toBe(344);
});

test('maskStopsFor keeps content visible under the composer and fades at the bottom', () => {
  const height = 400;
  const bottomInset = 42;
  const composerHeight = 160;
  const composerTop = 1 - composerHeight / height;
  const fadeStart = 1 - (bottomInset + COMPOSER_BOTTOM_FADE_BAND) / height;
  const fadeEnd = 1 - bottomInset / height;
  const stops = maskStopsFor(
    height,
    80,
    28,
    bottomInset,
    COMPOSER_BOTTOM_FADE_BAND,
  );
  expect(stops.locations[0]).toBe(0);
  expect(stops.locations[stops.locations.length - 1]).toBe(1);
  expect(stops.colors[0]).toBe('transparent');
  expect(stops.colors[stops.colors.length - 1]).toBe('transparent');
  expect(fadeStart).toBeGreaterThan(composerTop);
  expect(stops.locations).toContain(fadeStart);
  expect(stops.colors[stops.locations.indexOf(fadeStart)]).toBe('black');
  expect(stops.locations).toContain(fadeEnd);
  expect(stops.colors[stops.locations.indexOf(fadeEnd)]).toBe('transparent');
  expect(stops.colors.some(c => c.startsWith('rgba(0,0,0,'))).toBe(true);
  expect(COMPOSER_BOTTOM_FADE_BAND).toBe(44);
});

test('FadeBlur none mode still mounts a blur', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<FadeBlur fade="none" intensity={80} />);
  });
  expect(tree!.root.findByProps({ intensity: 80 })).toBeTruthy();
  await act(async () => {
    tree?.unmount();
  });
});
