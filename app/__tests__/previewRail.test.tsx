import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { PreviewRail } from '../src/components/agentsKit/PreviewRail';
import type { RailItem } from '../src/components/agentsKit/messagePreview';

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

const renderRail = async (
  onItemSelect: (item: RailItem) => void = () => {},
  extra: { dismissKey?: number } = {},
) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <PreviewRail
        items={items}
        label="Message navigation"
        activeId="u1"
        onItemSelect={onItemSelect}
        top={40}
        bottom={80}
        right={4}
        railHeight={400}
        dismissKey={extra.dismissKey}
      />,
    );
  });
  return tree!;
};

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
  expect(onItemSelect).toHaveBeenCalledWith(items[0]);
  const preview = tree.root.findByProps({ testID: 'preview-rail-preview' });
  const labels = preview.findAllByType(Text).map(n => n.props.children);
  expect(labels).toContain('What should the first release include?');
  expect(labels).toContain('Start with the smallest workflow.');

  await act(async () => {
    tree.unmount();
  });
});

test('pressing outside clears the pinned preview', async () => {
  const tree = await renderRail();
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
    tree.root
      .findAll(
        n =>
          n.props.testID === 'preview-rail-dismiss' &&
          typeof n.props.onPress === 'function',
      )[0]
      .props.onPress();
  });
  expect(
    tree.root.findAll(n => n.props.testID === 'preview-rail-preview'),
  ).toHaveLength(0);

  await act(async () => {
    tree.unmount();
  });
});
