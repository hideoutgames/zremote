import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { WorkingStatusRow } from '../WorkingStatus';
import { flavourSeed, flavourWord } from '../workingMotion';

test('WorkingStatusRow shows flavour plus elapsed', async () => {
  const now = 1_800_000_000_000;
  const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
  const startedAt = now - 58_000;
  let tree: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => {
      tree = TestRenderer.create(
        <WorkingStatusRow chatId="c1" startedAt={startedAt} />,
      );
    });
    const labels = tree!.root.findAllByType(Text).flatMap(n => {
      const c = n.props.children;
      return Array.isArray(c) ? c : [c];
    });
    expect(labels).toContain(`${flavourWord(flavourSeed('c1'), 58)}…`);
    expect(labels).toContain('58s');
    expect(
      tree!.root.findAll(n => n.props.testID === 'working-status-strip'),
    ).toHaveLength(1);
    expect(
      tree!.root.findAll(n => n.props.testID === 'working-status-elapsed'),
    ).toHaveLength(1);
  } finally {
    await act(async () => {
      tree?.unmount();
    });
    spy.mockRestore();
  }
});
