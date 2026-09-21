import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Platform, Pressable, Text } from 'react-native';
import { useDismissibleNativeModal } from '../useDismissibleNativeModal';

function Probe({ onDismissed }: { onDismissed: () => void }) {
  const modal = useDismissibleNativeModal(onDismissed);
  return (
    <>
      <Text testID="visible">{modal.visible ? '1' : '0'}</Text>
      <Pressable testID="hide" onPress={modal.hide} />
      <Pressable testID="request-close" onPress={modal.onRequestClose} />
      <Pressable testID="native-dismiss" onPress={modal.onDismiss} />
    </>
  );
}

const visibleOf = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root.findByProps({ testID: 'visible' }).props.children;

describe('useDismissibleNativeModal', () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOs;
  });

  it('hides first and unmounts on iOS only after native onDismiss', async () => {
    Platform.OS = 'ios';
    const onDismissed = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Probe onDismissed={onDismissed} />);
    });
    expect(visibleOf(tree)).toBe('1');

    await act(async () => {
      tree.root.findByProps({ testID: 'request-close' }).props.onPress();
    });
    expect(visibleOf(tree)).toBe('0');
    expect(onDismissed).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByProps({ testID: 'native-dismiss' }).props.onPress();
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.root.findByProps({ testID: 'native-dismiss' }).props.onPress();
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });

  it('unmounts on Android after the hide commit', async () => {
    Platform.OS = 'android';
    const onDismissed = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Probe onDismissed={onDismissed} />);
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'hide' }).props.onPress();
    });
    expect(visibleOf(tree)).toBe('0');
    expect(onDismissed).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.root.findByProps({ testID: 'native-dismiss' }).props.onPress();
    });
    expect(onDismissed).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount();
    });
  });
});
