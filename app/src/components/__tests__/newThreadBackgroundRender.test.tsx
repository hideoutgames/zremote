import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as SkiaNS from '@shopify/react-native-skia';
import { NewThreadBackground } from '../NewThreadBackground';
import { uiPrefsStore } from '../../zeron/state/uiPrefs';
import { setWallpaperContrast } from '../../zeron/state/wallpaperContrast';

const wallpaper = {
  uri: 'file:///docs/new-thread-backgrounds/x.png',
  name: 'sunset.png',
};

const fakeImage = {
  width: () => 120,
  height: () => 80,
};

let tree: TestRenderer.ReactTestRenderer | undefined;

const layoutArtwork = async () => {
  const artwork = tree!.root.findByProps({
    testID: 'new-thread-background-artwork',
  });
  await act(() => {
    artwork.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
    });
  });
};

beforeEach(() => {
  jest.spyOn(SkiaNS.Skia.RuntimeEffect, 'Make').mockReturnValue({} as never);
  jest.spyOn(SkiaNS, 'useImage').mockReturnValue(fakeImage as never);
  uiPrefsStore.setState({
    newThreadComposerBackground: wallpaper,
    newThreadBackgroundEffect: 'none',
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  setWallpaperContrast(undefined, undefined);
  jest.restoreAllMocks();
});

test('effect none keeps the untreated ExpoImage after layout', async () => {
  await act(async () => {
    tree = TestRenderer.create(<NewThreadBackground />);
  });
  await layoutArtwork();
  expect(
    tree!.root.findAll(
      n => n.props.testID === 'new-thread-background-untreated',
    ).length,
  ).toBeGreaterThan(0);
  expect(tree!.root.findAllByType(SkiaNS.Shader)).toHaveLength(0);
  expect(
    tree!.root.findAll(n => n.props.testID === 'new-thread-background-treated'),
  ).toHaveLength(0);
});

test('treated effects mount a live Shader and ImageShader, not a snapshot image', async () => {
  uiPrefsStore.setState({ newThreadBackgroundEffect: 'dither' });
  await act(async () => {
    tree = TestRenderer.create(<NewThreadBackground />);
  });
  await layoutArtwork();
  expect(
    tree!.root.findByProps({ testID: 'new-thread-background-treated' }),
  ).toBeTruthy();
  expect(tree!.root.findAllByType(SkiaNS.Shader).length).toBeGreaterThan(0);
  expect(tree!.root.findAllByType(SkiaNS.ImageShader).length).toBeGreaterThan(
    0,
  );
  expect(tree!.root.findAllByType(SkiaNS.Image)).toHaveLength(0);
  const imageShader = tree!.root.findByType(SkiaNS.ImageShader);
  expect(imageShader.props.fit).toBe('fill');
  expect(imageShader.props.image).toBe(fakeImage);
});
