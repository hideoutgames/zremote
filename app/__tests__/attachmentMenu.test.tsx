import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AttachmentMenu } from '../src/components/AttachmentMenu';

const render = async (element: React.ReactElement) => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree!;
};

test('plan row is a checkbox that can disable an already-on plan', async () => {
  const onToggle = jest.fn();
  const mounted = await render(
    <AttachmentMenu
      onPickPhotos={() => {}}
      onPickCamera={() => {}}
      onPickFiles={() => {}}
      planEnabled
      onTogglePlan={onToggle}
    />,
  );
  const box = mounted.root.findByProps({ testID: 'DropdownCheckbox' });
  expect(box.props.value).toBe(true);
  await act(async () => {
    box.props.onValueChange('off');
  });
  expect(onToggle).toHaveBeenCalledWith(false);
});

test('plan checkbox is omitted without a toggle handler', async () => {
  const mounted = await render(
    <AttachmentMenu
      onPickPhotos={() => {}}
      onPickCamera={() => {}}
      onPickFiles={() => {}}
    />,
  );
  expect(
    mounted.root.findAll(n => n.props.testID === 'DropdownCheckbox'),
  ).toHaveLength(0);
});
