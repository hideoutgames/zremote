import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { MarkdownWithCopy } from '../src/components/transcript/MarkdownWithCopy';

const markdownNodes = (root: TestRenderer.ReactTestInstance) =>
  root.findAll(n => n.props.md4cFlags != null || n.props.flavor === 'github');

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

test('MarkdownWithCopy disables LaTeX so $ stays plain text', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<MarkdownWithCopy markdown="export $HOME" />);
  });
  const nodes = markdownNodes(tree!.root);
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.every(n => n.props.md4cFlags?.latexMath === false)).toBe(true);
  await act(async () => {
    tree?.unmount();
  });
});

test('MarkdownWithCopy stretches native markdown to the bubble width', async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<MarkdownWithCopy markdown="hello" />);
  });
  const nodes = markdownNodes(tree!.root);
  expect(nodes.length).toBeGreaterThan(0);
  expect(
    nodes.every(n => {
      const style = StyleSheet.flatten(n.props.containerStyle);
      return style?.alignSelf === 'stretch' && style?.width === '100%';
    }),
  ).toBe(true);
  await act(async () => {
    tree?.unmount();
  });
});
