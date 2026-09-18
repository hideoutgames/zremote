import {
  layoutFor,
  REGULAR_MIN_WIDTH,
  INSPECTOR_AUTO_WIDTH,
  MEASURE_CAP_MAX,
} from '../src/navigation/layout';

const prefs = { sidebarCollapsed: false, inspectorOpen: false };

test('compact below 700pt keeps the pager', () => {
  const l = layoutFor(390, prefs);
  expect(l.mode).toBe('compact');
  expect(l.sidebarVisible).toBe(false);
  expect(l.inspectorVisible).toBe(false);
});

test('regular width shows sidebar + detail, inspector stays closed', () => {
  const l = layoutFor(820, prefs);
  expect(l.mode).toBe('regular');
  expect(l.sidebarVisible).toBe(true);
  expect(l.inspectorVisible).toBe(false);
  expect(l.sidebarWidth).toBeGreaterThanOrEqual(300);
  expect(l.sidebarWidth).toBeLessThanOrEqual(360);
});

test('sidebar collapse persists through prefs', () => {
  const l = layoutFor(820, { ...prefs, sidebarCollapsed: true });
  expect(l.sidebarVisible).toBe(false);
});

test('inspector does not auto-show at 1100pt; only when toggled', () => {
  expect(layoutFor(INSPECTOR_AUTO_WIDTH, prefs).inspectorVisible).toBe(false);
  expect(
    layoutFor(900, { ...prefs, inspectorOpen: true }).inspectorVisible,
  ).toBe(true);
  const l = layoutFor(1400, { ...prefs, inspectorOpen: true });
  expect(l.inspectorWidth).toBeGreaterThanOrEqual(360);
  expect(l.inspectorWidth).toBeLessThanOrEqual(480);
});

test('measure cap fills remaining detail up to 1100', () => {
  const l = layoutFor(1400, prefs);
  expect(l.measureCap).toBe(Math.min(MEASURE_CAP_MAX, 1400 - l.sidebarWidth));
  expect(l.measureCap).toBeGreaterThan(REGULAR_MIN_WIDTH);
  expect(l.measureCap).toBeLessThanOrEqual(MEASURE_CAP_MAX);
});
