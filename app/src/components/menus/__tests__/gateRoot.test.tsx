import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Pressable } from 'react-native';
import { gateRoot, MENU_DISMISS_HOLD_MS } from '../gateRoot';
import { menuOpenCount, resetMenuGate } from '../menuGate';

function DummyRoot({
  onOpenChange,
  onOpenWillChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onOpenWillChange?: (willOpen: boolean) => void;
}) {
  return (
    <Pressable testID="open" onPress={() => onOpenChange?.(true)}>
      <Pressable testID="close" onPress={() => onOpenChange?.(false)} />
      <Pressable testID="will-open" onPress={() => onOpenWillChange?.(true)} />
      <Pressable
        testID="will-close"
        onPress={() => onOpenWillChange?.(false)}
      />
    </Pressable>
  );
}

const Gated = gateRoot(DummyRoot);

describe('gateRoot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    resetMenuGate();
    jest.useRealTimers();
  });

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

  it('opens immediately on onOpenWillChange(true)', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Gated />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'will-open' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(1);
  });

  it('holds the gate open until MENU_DISMISS_HOLD_MS after will-close', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Gated />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'will-open' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'will-close' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(MENU_DISMISS_HOLD_MS - 1);
    });
    expect(menuOpenCount()).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(menuOpenCount()).toBe(0);
  });

  it('closes immediately on onOpenChange(false) and cancels a pending hold', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Gated />);
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'will-open' }).props.onPress();
      tree.root.findByProps({ testID: 'will-close' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(1);

    await act(async () => {
      tree.root.findByProps({ testID: 'close' }).props.onPress();
    });
    expect(menuOpenCount()).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(MENU_DISMISS_HOLD_MS);
    });
    expect(menuOpenCount()).toBe(0);
  });
});
