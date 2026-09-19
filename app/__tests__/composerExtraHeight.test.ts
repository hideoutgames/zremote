import {
  COMPOSER_EXTRA_MAX,
  COMPOSER_EXTRA_WINDOW_FRAC,
  clampComposerExtraHeight,
  composerExtraMax,
  composerListInset,
} from '../src/components/composerExtraHeight';

test('caps are 10% below the previous 280 / 0.4 limits', () => {
  expect(COMPOSER_EXTRA_MAX).toBe(252);
  expect(COMPOSER_EXTRA_WINDOW_FRAC).toBe(0.36);
});

test('composerExtraMax uses the window fraction on short screens', () => {
  expect(composerExtraMax(600)).toBe(Math.round(600 * 0.36));
});

test('composerExtraMax is clamped by COMPOSER_EXTRA_MAX on tall screens', () => {
  expect(composerExtraMax(1000)).toBe(COMPOSER_EXTRA_MAX);
  expect(Math.round(1000 * 0.36)).toBeGreaterThan(COMPOSER_EXTRA_MAX);
});

test('clampComposerExtraHeight stays in [0, max]', () => {
  expect(clampComposerExtraHeight(-10, 252)).toBe(0);
  expect(clampComposerExtraHeight(280, 252)).toBe(252);
  expect(clampComposerExtraHeight(40, 252)).toBe(40);
});

test('composerListInset delta equals extraHeight', () => {
  const base = 180;
  expect(composerListInset(base, 0)).toBe(base);
  expect(composerListInset(base, 40)).toBe(220);
  expect(composerListInset(base, 40) - composerListInset(base, 0)).toBe(40);
});
