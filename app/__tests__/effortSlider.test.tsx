import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { EffortSlider } from '../src/components/EffortSlider';
import {
  effortSliderThumbInset,
  effortSliderThumbSize,
  effortSliderTrackHeight,
  stopFraction,
} from '../src/components/effortSliderMath';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';

const mocked = Haptics as jest.Mocked<typeof Haptics>;
const LEVELS = ['low', 'medium', 'high'] as const;
const TRACK_WIDTH = 200;

const stopX = (index: number): number => {
  const inset = effortSliderThumbInset + effortSliderThumbSize / 2;
  const travel = TRACK_WIDTH - inset * 2;
  return inset + travel * stopFraction(index, LEVELS.length);
};

const touch = (locationX: number) => ({ nativeEvent: { locationX } });

beforeEach(() => {
  mocked.selectionAsync.mockClear();
  uiPrefsStore.setState({ hapticsEnabled: true });
});

const mount = async (value: string, onChange = jest.fn()) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <EffortSlider levels={LEVELS} value={value} onChange={onChange} />,
    );
  });
  const track = tree!.root.findByProps({ accessibilityRole: 'adjustable' });
  act(() => {
    track.props.onLayout({
      nativeEvent: {
        layout: { width: TRACK_WIDTH, height: effortSliderTrackHeight },
      },
    });
  });
  return { tree: tree!, track, onChange };
};

test('crossing a stop ticks selection haptics once and reports the new level', async () => {
  const { track, onChange } = await mount('medium');
  act(() => {
    track.props.onResponderGrant(touch(stopX(1)));
    track.props.onResponderMove(touch(stopX(2)));
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('high');
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
});

test('extra moves and release on the same stop do not tick again even if value is stale', async () => {
  const onChange = jest.fn();
  const { tree, track } = await mount('medium', onChange);
  act(() => {
    track.props.onResponderGrant(touch(stopX(1)));
    track.props.onResponderMove(touch(stopX(2)));
  });
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);

  // Parent still has the old value — the same situation as a lagged
  // setReasoning / setChatConfig. A re-render must not re-arm ticks.
  await act(async () => {
    tree.update(
      <EffortSlider levels={LEVELS} value="medium" onChange={onChange} />,
    );
  });
  const still = tree.root.findByProps({ accessibilityRole: 'adjustable' });
  act(() => {
    still.props.onResponderMove(touch(stopX(2)));
    still.props.onResponderMove(touch(stopX(2) - 4));
    still.props.onResponderRelease(touch(stopX(2)));
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
});

test('accessibility increment ticks once and reports the next level', async () => {
  const { track, onChange } = await mount('medium');
  act(() => {
    track.props.onAccessibilityAction({
      nativeEvent: { actionName: 'increment' },
    });
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('high');
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
});
