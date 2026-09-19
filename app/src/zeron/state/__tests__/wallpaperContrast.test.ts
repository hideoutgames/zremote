import {
  averageLuminanceFromRgba,
  contrastSchemeFromLuminance,
  luminanceOfRgb,
} from '../src/zeron/state/wallpaperContrast';

test('luminanceOfRgb weights green most', () => {
  expect(luminanceOfRgb(255, 255, 255)).toBeCloseTo(1);
  expect(luminanceOfRgb(0, 0, 0)).toBeCloseTo(0);
  expect(luminanceOfRgb(0, 255, 0)).toBeGreaterThan(luminanceOfRgb(255, 0, 0));
});

test('contrastSchemeFromLuminance splits around the cutoff', () => {
  expect(contrastSchemeFromLuminance(0.2)).toBe('dark');
  expect(contrastSchemeFromLuminance(0.8)).toBe('light');
});

test('averageLuminanceFromRgba skips transparent pixels', () => {
  const pixels = Uint8Array.of(255, 255, 255, 0, 0, 0, 0, 255);
  expect(averageLuminanceFromRgba(pixels)).toBeCloseTo(0);
});
