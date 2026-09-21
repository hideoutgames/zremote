import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  chromeThemeFor,
  ChromeThemeProvider,
  useChromeTheme,
} from '../src/chromeTheme';
import { darkTheme, lightTheme, useTheme } from '../src/theme';
import { uiPrefsStore } from '../src/zeron/state/uiPrefs';

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

function Probe({ onTheme }: { onTheme: (theme: typeof darkTheme) => void }) {
  onTheme(useChromeTheme());
  return null;
}

afterEach(() => {
  mockedUseTheme.mockReset();
  mockedUseTheme.mockReturnValue(darkTheme);
  uiPrefsStore.setState({ newThreadComposerBackground: undefined });
});

test('chromeThemeFor is dark when wallpaper is set', () => {
  expect(chromeThemeFor(true, lightTheme)).toBe(darkTheme);
  expect(chromeThemeFor(true, darkTheme)).toBe(darkTheme);
});

test('chromeThemeFor follows the content theme without wallpaper', () => {
  expect(chromeThemeFor(false, lightTheme)).toBe(lightTheme);
  expect(chromeThemeFor(false, darkTheme)).toBe(darkTheme);
});

test('useChromeTheme follows useTheme without a provider, even with wallpaper', async () => {
  mockedUseTheme.mockReturnValue(lightTheme);
  uiPrefsStore.setState({
    newThreadComposerBackground: {
      uri: 'file:///docs/new-thread-backgrounds/x.png',
      name: 'sunset.png',
    },
  });
  let seen: typeof lightTheme | undefined;
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <Probe
        onTheme={theme => {
          seen = theme;
        }}
      />,
    );
  });
  expect(seen).toBe(lightTheme);
  await act(async () => {
    tree?.unmount();
  });
});

test('useChromeTheme uses the provided theme', async () => {
  mockedUseTheme.mockReturnValue(lightTheme);
  let seen: typeof lightTheme | undefined;
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(
      <ChromeThemeProvider theme={darkTheme}>
        <Probe
          onTheme={theme => {
            seen = theme;
          }}
        />
      </ChromeThemeProvider>,
    );
  });
  expect(seen).toBe(darkTheme);
  await act(async () => {
    tree?.unmount();
  });
});
