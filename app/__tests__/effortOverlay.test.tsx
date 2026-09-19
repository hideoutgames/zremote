import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Switch } from 'react-native';
import {
  EffortOverlay,
  effortDestRect,
  effortWashRect,
} from '../src/components/EffortOverlay';
import { effortSliderTrackHeight } from '../src/components/effortSliderMath';

test('effort overlay is a centered Modal with a slider and no Fast switch', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <EffortOverlay
        levels={['low', 'medium', 'high']}
        value="medium"
        onChange={() => {}}
        onDismiss={() => {}}
      />,
    );
  });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(1);
  expect(tree!.root.findAllByType(Switch)).toHaveLength(0);
  const labels = tree!.root.findAll(
    n => typeof n.props.accessibilityRole === 'string',
  );
  expect(labels.some(n => n.props.accessibilityRole === 'adjustable')).toBe(
    true,
  );
  expect(
    labels.some(
      n =>
        n.props.accessibilityRole === 'button' &&
        n.props.accessibilityLabel === 'Done',
    ),
  ).toBe(true);
  act(() => {
    tree?.unmount();
  });
});

test('tapping the effort overlay backdrop dismisses it', async () => {
  const onDismiss = jest.fn();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <EffortOverlay
        levels={['low', 'medium', 'high']}
        value="medium"
        onChange={() => {}}
        onDismiss={onDismiss}
      />,
    );
  });
  const done = tree!.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel === 'Done',
  )[0];
  await act(async () => {
    done.props.onPress();
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  act(() => {
    tree?.unmount();
  });
});

test('effort dest rect stays at mid-screen height and centers on an iPad composer column', () => {
  const windowed = effortDestRect(1024, 768);
  expect(windowed.x + windowed.width / 2).toBe(512);
  expect(windowed.y + windowed.height / 2).toBe(384);
  expect(windowed.height).toBe(effortSliderTrackHeight);

  const anchored = effortDestRect(1024, 768, {
    x: 340,
    y: 500,
    width: 400,
    height: 180,
  });
  expect(anchored.x + anchored.width / 2).toBe(540);
  expect(anchored.y + anchored.height / 2).toBe(384);
});

test('effort wash extends around the label and slider, not just the text', () => {
  const dest = effortDestRect(1024, 768, {
    x: 340,
    y: 500,
    width: 400,
    height: 180,
  });
  const wash = effortWashRect(dest);
  expect(wash.width).toBeGreaterThan(dest.width);
  expect(wash.height).toBeGreaterThan(dest.height + 36);
  expect(wash.x).toBeLessThan(dest.x);
  expect(wash.y).toBeLessThan(dest.y - 36);
  expect(wash.x + wash.width).toBeGreaterThan(dest.x + dest.width);
  expect(wash.y + wash.height).toBeGreaterThan(dest.y + dest.height);
  // Inner 50% plateau (fade locations 0.25–0.75) covers the cluster.
  expect(wash.x + wash.width * 0.25).toBeCloseTo(dest.x);
  expect(wash.x + wash.width * 0.75).toBeCloseTo(dest.x + dest.width);
});

test('effort overlay accepts a composer anchor without crashing', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <EffortOverlay
        levels={['low', 'medium', 'high']}
        value="medium"
        origin={{ x: 360, y: 620, width: 80, height: 28 }}
        anchor={{ x: 340, y: 500, width: 400, height: 180 }}
        onChange={() => {}}
        onDismiss={() => {}}
      />,
    );
  });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(1);
  act(() => {
    tree?.unmount();
  });
});
