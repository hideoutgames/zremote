// The chevron must follow useTheme(), not the static dark `theme` export.
// Light mode is white glass — a leftover #FFFFFF tint is invisible.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ScrollToBottomButton } from '../src/components/ScrollToBottomButton';
import { darkTheme, lightTheme, useTheme } from '../src/theme';

jest.mock('../src/theme', () => {
  const actual = jest.requireActual(
    '../src/theme',
  ) as typeof import('../src/theme');
  return {
    ...actual,
    useTheme: jest.fn(() => actual.darkTheme),
  };
});

const mockedUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

const render = async () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<ScrollToBottomButton onPress={() => {}} />);
  });
  return tree!;
};

const chevronTint = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findByProps({ symbolName: 'chevron.down' }).props.tintColor;

afterEach(() => {
  mockedUseTheme.mockReset();
  mockedUseTheme.mockReturnValue(darkTheme);
});

test('uses light-theme text for the chevron in light mode', async () => {
  mockedUseTheme.mockReturnValue(lightTheme);
  const tree = await render();
  expect(chevronTint(tree)).toBe(lightTheme.text);
  await act(async () => {
    tree.unmount();
  });
});

test('uses dark-theme text for the chevron in dark mode', async () => {
  mockedUseTheme.mockReturnValue(darkTheme);
  const tree = await render();
  expect(chevronTint(tree)).toBe(darkTheme.text);
  await act(async () => {
    tree.unmount();
  });
});
