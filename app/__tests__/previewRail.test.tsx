import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PreviewRail } from '../src/components/agentsKit/PreviewRail';
import {
  RAIL_ITEM_SIZE,
  railItemSize,
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

const stackTop = (): number => {
  const itemSize = railItemSize(items.length, RAIL_HEIGHT);
  const stackHeight = itemSize * items.length;
  return items.length * RAIL_ITEM_SIZE <= RAIL_HEIGHT
    ? Math.max(0, (RAIL_HEIGHT - stackHeight) / 2)
    : 0;
};

const yForIndex = (index: number): number => {
  const itemSize = railItemSize(items.length, RAIL_HEIGHT);
  return stackTop() + index * itemSize + itemSize / 2;
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
  ).toBe('none');
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
  expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree.unmount();
  });
});

test('pageY maps to a tick when locationY is missing', async () => {
  const onItemSelect = jest.fn();
  const tree = await renderRail(onItemSelect);
  const track = tree.root.findByProps({ testID: 'preview-rail-track' });

  await act(async () => {
    track.props.onResponderGrant({ nativeEvent: { pageY: yForIndex(1) } });
  });
  expect(onItemSelect).toHaveBeenCalledWith(items[1], { animated: true });

  await act(async () => {
    tree.unmount();
  });
});
