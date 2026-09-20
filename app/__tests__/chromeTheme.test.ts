import { chromeThemeFor } from '../src/chromeTheme';
import { darkTheme, lightTheme } from '../src/theme';

test('chromeThemeFor is dark when wallpaper is set', () => {
  expect(chromeThemeFor(true, lightTheme)).toBe(darkTheme);
  expect(chromeThemeFor(true, darkTheme)).toBe(darkTheme);
});

test('chromeThemeFor follows the content theme without wallpaper', () => {
  expect(chromeThemeFor(false, lightTheme)).toBe(lightTheme);
  expect(chromeThemeFor(false, darkTheme)).toBe(darkTheme);
});
