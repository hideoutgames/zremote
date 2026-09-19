import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Switch } from 'react-native';
import { EffortOverlay } from '../src/components/EffortOverlay';

test('effort overlay has a slider and no Fast mode switch', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <EffortOverlay
        levels={['low', 'medium', 'high']}
        value="medium"
        onChange={() => {}}
      />,
    );
  });
  expect(tree!.root.findAllByType(Switch)).toHaveLength(0);
  const labels = tree!.root.findAll(
    n => typeof n.props.accessibilityRole === 'string',
  );
  expect(labels.some(n => n.props.accessibilityRole === 'adjustable')).toBe(
    true,
  );
  act(() => {
    tree?.unmount();
  });
});
