import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { GlassSheet, GLASS_SHEET_DETENTS } from '../src/components/GlassSheet';

test('GlassSheet defaults to half-screen with a full-screen swipe detent', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <GlassSheet title="Thought process" onDismiss={() => {}}>
        {null}
      </GlassSheet>,
    );
  });
  const sheet = tree!.root.findByProps({ testID: 'TrueSheet' });
  expect(GLASS_SHEET_DETENTS).toEqual([0.5, 1]);
  expect(sheet.props.detents).toEqual([0.5, 1]);
  expect(sheet.props.initialDetentIndex).toBe(0);
});
