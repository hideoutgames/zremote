import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Modal, Switch } from 'react-native';
import { EffortOverlay, effortDestRect } from '../src/components/EffortOverlay';
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

test('effort dest rect centers on the window, or on an iPad composer anchor', () => {
  const windowed = effortDestRect(1024, 768);
  expect(windowed.x + windowed.width / 2).toBe(512);
  expect(windowed.y + windowed.height / 2).toBe(384);
  expect(windowed.height).toBe(effortSliderTrackHeight + 16);

  const anchored = effortDestRect(1024, 768, {
    x: 340,
    y: 500,
    width: 400,
    height: 180,
  });
  expect(anchored.x + anchored.width / 2).toBe(540);
  expect(anchored.y + anchored.height / 2).toBe(590);
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
