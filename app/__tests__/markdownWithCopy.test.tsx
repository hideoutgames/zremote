import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MarkdownWithCopy } from '../src/components/transcript/MarkdownWithCopy';

test('MarkdownWithCopy overlays a copy control on fenced code', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <MarkdownWithCopy markdown={'```ts\nconst n = 1;\n```'} />,
    );
  });
  expect(
    tree!.root.findAll(n => n.props.testID === 'code-fence').length,
  ).toBeGreaterThan(0);
  expect(
    tree!.root.findAll(n => n.props.testID === 'code-fence-copy').length,
  ).toBeGreaterThan(0);
  await act(async () => {
    tree?.unmount();
  });
});
