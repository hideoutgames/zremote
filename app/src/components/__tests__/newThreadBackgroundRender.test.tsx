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
  makeNonTextureImage: () => null,
  makeShaderOptions: () => ({}),
  readPixels: () => new Uint8Array([255, 255, 255, 255]),
};

const fakeRasterSnapshot = {
  width: () => 120,
  height: () => 80,
  readPixels: () => new Uint8Array([255, 255, 255, 255]),
};

// GPU-backed offscreen snapshot: must be read back before the Canvas draws it.
const fakeSnapshot = {
  width: () => 120,
  height: () => 80,
  makeNonTextureImage: () => fakeRasterSnapshot,
  readPixels: () => new Uint8Array([255, 255, 255, 255]),
};

const fakeCanvas = {
  drawImageRect: jest.fn(),
  drawImageRectOptions: jest.fn(),
  drawRect: jest.fn(),
};

const fakeSurface = {
  getCanvas: () => fakeCanvas,
  makeImageSnapshot: () => fakeSnapshot,
  flush: jest.fn(),
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
  jest.spyOn(SkiaNS.Skia.RuntimeEffect, 'Make').mockReturnValue({
    makeShaderWithChildren: jest.fn(() => ({})),
  } as never);
  jest
    .spyOn(SkiaNS.Skia.Surface, 'MakeOffscreen')
    .mockReturnValue(fakeSurface as never);
  jest
    .spyOn(SkiaNS.Skia, 'Paint')
    .mockReturnValue({ setShader: jest.fn() } as never);
  jest
    .spyOn(SkiaNS.Skia, 'XYWHRect')
    .mockImplementation(
      (x: number, y: number, width: number, height: number) =>
        ({ x, y, width, height } as never),
    );
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

test('treated effects rasterize offscreen and draw the snapshot cover-fit', async () => {
  uiPrefsStore.setState({ newThreadBackgroundEffect: 'dither' });
  await act(async () => {
    tree = TestRenderer.create(<NewThreadBackground />);
  });
  await layoutArtwork();
  expect(
    tree!.root.findByProps({ testID: 'new-thread-background-treated' }),
  ).toBeTruthy();
  // The pattern must be baked at source resolution, then scaled — live
  // shaders resample the Bayer/halftone thresholds per device pixel and
  // alias into block artifacts (the cube pattern regression).
  expect(tree!.root.findAllByType(SkiaNS.Shader)).toHaveLength(0);
  expect(tree!.root.findAllByType(SkiaNS.ImageShader)).toHaveLength(0);
  expect(tree!.root.findAllByType(SkiaNS.Image)).toHaveLength(1);
  const image = tree!.root.findByType(SkiaNS.Image);
  expect(image.props.fit).toBe('cover');
  expect(image.props.image).toBe(fakeRasterSnapshot);
});

test('an empty raster falls back to the untreated image', async () => {
  jest.spyOn(fakeSurface, 'makeImageSnapshot').mockReturnValue({
    width: () => 120,
    height: () => 80,
    makeNonTextureImage: () => null,
    readPixels: () => new Uint8Array(256),
  } as never);
  uiPrefsStore.setState({ newThreadBackgroundEffect: 'dither' });
  await act(async () => {
    tree = TestRenderer.create(<NewThreadBackground />);
  });
  await layoutArtwork();
  expect(
    tree!.root.findAll(n => n.props.testID === 'new-thread-background-treated'),
  ).toHaveLength(0);
  expect(
    tree!.root.findAll(
      n => n.props.testID === 'new-thread-background-untreated',
    ).length,
  ).toBeGreaterThan(0);
});
