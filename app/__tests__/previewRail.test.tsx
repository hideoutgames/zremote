import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  PreviewRail,
  RAIL_HIT_PAD_Y,
} from '../src/components/agentsKit/PreviewRail';
import {
  railItemSize,
  railProgressAtY,
  type RailItem,
} from '../src/components/agentsKit/messagePreview';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';

const mocked = Haptics as jest.Mocked<typeof Haptics>;

const items: RailItem[] = [
  {
    id: 'u1',
    label: 'What should the first release include?',
    description: 'Start with the smallest workflow.',
    ariaLabel: 'Go to user message 1 of 2',
  },
  {
    id: 'a1',
    label: 'Start with the smallest workflow.',
    ariaLabel: 'Go to assistant message 2 of 2',
  },
];

const RAIL_HEIGHT = 400;

// The responder track hugs the tick stack, so stack-relative y in touch
// space starts at the pad, not the rail's visual centering offset.
const stackTop = (): number => RAIL_HIT_PAD_Y;

const yForIndex = (index: number): number => {
  const itemSize = railItemSize(items.length, RAIL_HEIGHT);
  return stackTop() + index * itemSize + itemSize / 2;
};

// Dead zones above/below the stack must not be hittable — a touch there
// used to clamp to the first/last tick and read as a jump to top/bottom.
const deadZoneHeight = (): number => {
  const itemSize = railItemSize(items.length, RAIL_HEIGHT);
  return (RAIL_HEIGHT - itemSize * items.length) / 2 - RAIL_HIT_PAD_Y;
};

const touch = (locationY: number, pageY = locationY) => ({
  nativeEvent: { locationY, pageY },
});

const railProps = (
  onItemSelect: (
    item: RailItem,
    opts?: { animated?: boolean },
  ) => void = () => {},
  extra: { dismissKey?: number } = {},
) => (
  <PreviewRail
    items={items}
    label="Message navigation"
    activeId="u1"
    onItemSelect={onItemSelect}
    top={40}
    bottom={80}
    right={4}
    railHeight={RAIL_HEIGHT}
    dismissKey={extra.dismissKey}
  />
);

const renderRail = async (
  onItemSelect: (
    item: RailItem,
    opts?: { animated?: boolean },
  ) => void = () => {},
  extra: { dismissKey?: number } = {},
) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(railProps(onItemSelect, extra));
  });
  return tree!;
};

beforeEach(() => {
  mocked.selectionAsync.mockClear();
  mocked.prepareSelectionAsync.mockClear();
  uiPrefsStore.setState({ hapticsEnabled: true });
});

test('renders a tick per item', async () => {
  const tree = await renderRail();
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail').length,
  ).toBeGreaterThan(0);
  expect(
    tree.root.findAll(
      n =>
        n.props.testID === 'preview-rail-item-u1' &&
        typeof n.props.onPress === 'function',
    ),
  ).toHaveLength(1);
  expect(
    tree.root.findAll(
      n =>
        n.props.testID === 'preview-rail-item-a1' &&
        typeof n.props.onPress === 'function',
    ),
  ).toHaveLength(1);
  await act(async () => {
    tree.unmount();
  });
});

test('overlay passes touches through; only the track is hittable', async () => {
  const tree = await renderRail();
  expect(
    tree.root.findByProps({ testID: 'preview-rail' }).props.pointerEvents,
  ).toBe('box-none');
  expect(
    tree.root.findByProps({ testID: 'preview-rail-track' }).props.pointerEvents,
  ).toBe('auto');
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-dismiss'),
  ).toHaveLength(0);
  await act(async () => {
    tree.unmount();
  });
});

test('the track hugs the tick stack, leaving dead zones untouchable', async () => {
  const tree = await renderRail();
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });
  const style = Object.assign(
    {},
    ...(Array.isArray(track.props.style)
      ? track.props.style.flat()
      : [track.props.style]),
  );
  // Two 14pt ticks centered in a 400pt rail sit 186pt down; the track
  // starts RAIL_HIT_PAD_Y above them and ends RAIL_HIT_PAD_Y below.
  expect(style.top).toBe(40 + 186 - RAIL_HIT_PAD_Y);
  expect(style.height).toBe(28 + RAIL_HIT_PAD_Y * 2);
  expect(deadZoneHeight()).toBeGreaterThan(0);
  await act(async () => {
    tree.unmount();
  });
});

test('pressing a tick selects it and shows the preview card', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-preview'),
  ).toHaveLength(0);

  await act(async () => {
    tree.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-u1' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(onItemSelect).toHaveBeenCalledWith(items[0], { animated: true });
  const preview = tree.root.findByProps({ testID: 'preview-rail-preview' });
  const labels = preview.findAllByType(Text).map(n => n.props.children);
  expect(labels).toContain('What should the first release include?');
  expect(labels).toContain('Start with the smallest workflow.');
  expect(mocked.selectionAsync).not.toHaveBeenCalled();
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-dismiss'),
  ).toHaveLength(0);

  await act(async () => {
    tree.unmount();
  });
});

test('dismissKey clears the pinned preview', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  await act(async () => {
    tree.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-item-u1' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-preview').length,
  ).toBeGreaterThan(0);

  await act(async () => {
    tree.update(railProps(onItemSelect, { dismissKey: 1 }));
  });
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-preview'),
  ).toHaveLength(0);

  await act(async () => {
    tree.unmount();
  });
});

test('a stationary tap on the rail selects without a haptic', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });

  await act(async () => {
    track.props.onResponderGrant(touch(yForIndex(0)));
  });
  expect(onItemSelect).toHaveBeenCalledTimes(1);
  expect(onItemSelect).toHaveBeenCalledWith(items[0], { animated: true });
  expect(mocked.prepareSelectionAsync).toHaveBeenCalledTimes(1);
  expect(mocked.selectionAsync).not.toHaveBeenCalled();
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-preview').length,
  ).toBeGreaterThan(0);

  await act(async () => {
    tree.unmount();
  });
});

test('dragging across ticks selects the next item and ticks once', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });

  await act(async () => {
    track.props.onResponderGrant(touch(yForIndex(0)));
    track.props.onResponderMove(touch(yForIndex(1)));
    track.props.onResponderMove(touch(yForIndex(1)));
    track.props.onResponderRelease?.(touch(yForIndex(1)));
  });
  expect(onItemSelect).toHaveBeenNthCalledWith(1, items[0], {
    animated: true,
  });
  expect(onItemSelect).toHaveBeenNthCalledWith(2, items[1], {
    animated: false,
  });
  expect(onItemSelect).toHaveBeenCalledTimes(2);
  expect(mocked.prepareSelectionAsync).toHaveBeenCalledTimes(1);
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree.unmount();
  });
});

test('dragging inside a tick keeps scrubbing with progress', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });
  const itemSize = railItemSize(items.length, RAIL_HEIGHT);
  const y0 = stackTop() + itemSize * 0.2;
  const y1 = stackTop() + itemSize * 0.7;

  await act(async () => {
    track.props.onResponderGrant(touch(y0));
    track.props.onResponderMove(touch(y1));
  });
  expect(onItemSelect).toHaveBeenNthCalledWith(1, items[0], {
    animated: true,
  });
  expect(onItemSelect).toHaveBeenNthCalledWith(2, items[0], {
    animated: false,
    progress: railProgressAtY(y1, items.length, itemSize, stackTop()),
  });
  expect(onItemSelect).toHaveBeenCalledTimes(2);
  expect(mocked.selectionAsync).not.toHaveBeenCalled();

  await act(async () => {
    tree.unmount();
  });
});

test('locationY wins over a window pageY', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });

  await act(async () => {
    track.props.onResponderGrant({
      nativeEvent: { locationY: yForIndex(1), pageY: 800 },
    });
  });
  expect(onItemSelect).toHaveBeenCalledWith(items[1], { animated: true });

  await act(async () => {
    tree.unmount();
  });
});
