import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable } from 'react-native';
import { gateRoot } from '../gateRoot';
import { menuOpenCount, resetMenuGate } from '../menuGate';

function DummyRoot({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onOpenWillChange?: (willOpen: boolean) => void;
}) {
  return (
    <Pressable testID="open" onPress={() => onOpenChange?.(true)}>
      <Pressable testID="close" onPress={() => onOpenChange?.(false)} />
    </Pressable>
  );
}

const Gated = gateRoot(DummyRoot);

describe('gateRoot', () => {
  afterEach(resetMenuGate);

  it('releases the menu gate when unmounted while open', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Gated />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'open' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(1);

    await act(async () => {
      tree.unmount();
    });
    expect(menuOpenCount()).toBe(0);
  });

  it('does not decrement twice when closed then unmounted', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Gated />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'open' }).props.onPress();
      tree.root.findByProps({ testID: 'close' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(0);

    await act(async () => {
      tree.unmount();
    });
    expect(menuOpenCount()).toBe(0);
  });
});
