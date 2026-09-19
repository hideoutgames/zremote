import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
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

test('GlassSheet fills the detent so body content is not collapsed', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <GlassSheet title="Thought process" onDismiss={() => {}}>
        {null}
      </GlassSheet>,
    );
  });
  const wrap = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'glass-sheet' }).props.style,
  );
  const body = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'glass-sheet-body' }).props.style,
  );
  const content = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'glass-sheet-content' }).props.style,
  );
  expect(wrap).toEqual(expect.objectContaining({ flex: 1, minHeight: '100%' }));
  expect(body).toEqual(expect.objectContaining({ flex: 1, minHeight: '100%' }));
  expect(content).toEqual(expect.objectContaining({ flex: 1, minHeight: 0 }));
});
