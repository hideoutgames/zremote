import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueueSheet } from '../src/components/QueueSheet';
import type { QueuedMessage } from '../src/zeron/protocol/types';

const rows: QueuedMessage[] = [
  { id: 'a', text: 'first', issuedBy: 'u', issuedAt: 1 },
  { id: 'b', text: 'second', issuedBy: 'u', issuedAt: 2 },
];

let lastTree: TestRenderer.ReactTestRenderer | undefined;

const renderSheet = async (
  props: Partial<React.ComponentProps<typeof QueueSheet>> = {},
) => {
  lastTree?.unmount();
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <QueueSheet
        queue={rows}
        actionsSupported
        pending={new Set()}
        canSteer
        onAction={() => {}}
        onMove={() => {}}
        onDismiss={() => {}}
        {...props}
      />,
    );
  });
  lastTree = tree!;
  return tree!;
};

afterEach(() => {
  lastTree?.unmount();
  lastTree = undefined;
});

test('queue sheet lists messages with send, steer, delete, and reorder', async () => {
  const onAction = jest.fn();
  const onMove = jest.fn();
  const tree = await renderSheet({ onAction, onMove });
  const labels = tree.root
    .findAll(n => typeof n.props.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);
  expect(labels).toContain('Send now');
  expect(labels).toContain('Steer now');
  expect(labels).toContain('Remove');
  expect(labels.filter(l => l === 'Reorder').length).toBeGreaterThanOrEqual(2);

  const send = tree.root.findAllByProps({ accessibilityLabel: 'Send now' })[0];
  await act(async () => {
    send.props.onPress();
  });
  expect(onAction).toHaveBeenCalledWith('a', 'sendNow');

  const reorder = tree.root.findAllByProps({ accessibilityLabel: 'Reorder' })[0];
  await act(async () => {
    reorder.props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    });
  });
  expect(onMove).toHaveBeenCalledWith('a', 1);
});

test('queue sheet hides steer when the host cannot steer', async () => {
  const tree = await renderSheet({ canSteer: false });
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Steer now' }),
  ).toHaveLength(0);
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Send now' }).length,
  ).toBeGreaterThan(0);
});
