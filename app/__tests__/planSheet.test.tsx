import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { PlanSheet } from '../src/components/PlanSheet';
import { SESSION_SHEET_GRABBER_INSET } from '../src/components/SessionSheet';

const texts = (root: TestRenderer.ReactTestInstance): string[] =>
  root.findAllByType(Text).flatMap(n => {
    const c = n.props.children;
    if (typeof c === 'string') return [c];
    return Array.isArray(c) ? c.filter(x => typeof x === 'string') : [];
  });

test('PlanSheet fills the detent so the plan body is not collapsed', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <PlanSheet
        name="Ship the login"
        markdown={'# Steps\n\n1. Fix auth\n2. Ship'}
        onDismiss={() => {}}
        onImplement={() => {}}
      />,
    );
  });
  const sheet = tree!.root.findByProps({ testID: 'TrueSheet' });
  expect(sheet.props.detents).toEqual([1]);
  expect(sheet.props.initialDetentIndex).toBe(0);
  expect(sheet.props.maxContentHeight).toBeGreaterThanOrEqual(240);

  const wrap = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'plan-sheet' }).props.style,
  );
  expect(wrap).toEqual(expect.objectContaining({ flex: 1, minHeight: '100%' }));

  const scroll = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'plan-sheet-scroll' }).props.style,
  );
  expect(scroll).toEqual(expect.objectContaining({ flex: 1, minHeight: 0 }));

  const header = StyleSheet.flatten(
    tree!.root.findByProps({ testID: 'plan-sheet-header' }).props.style,
  );
  expect(header).toEqual(
    expect.objectContaining({ paddingTop: SESSION_SHEET_GRABBER_INSET }),
  );

  expect(texts(tree!.root)).toEqual(
    expect.arrayContaining(['Ship the login', 'Implement Plan']),
  );
  expect(
    tree!.root.findByProps({ markdown: '# Steps\n\n1. Fix auth\n2. Ship' }),
  ).toBeTruthy();
});
