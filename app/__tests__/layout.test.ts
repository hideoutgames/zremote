import {
  layoutFor,
  REGULAR_MIN_WIDTH,
  INSPECTOR_AUTO_WIDTH,
} from '../src/navigation/layout';

const prefs = { sidebarCollapsed: false, inspectorOpen: false };

test('compact below 700pt keeps the pager', () => {
  const l = layoutFor(390, prefs);
  expect(l.mode).toBe('compact');
  expect(l.sidebarVisible).toBe(false);
  expect(l.inspectorVisible).toBe(false);
});

test('regular width shows sidebar + detail, no inspector below 1100', () => {
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

test('inspector column is never shown — tools launch from the overflow menu', () => {
  expect(layoutFor(INSPECTOR_AUTO_WIDTH, prefs).inspectorVisible).toBe(false);
  expect(
    layoutFor(900, { ...prefs, inspectorOpen: true }).inspectorVisible,
  ).toBe(false);
  const l = layoutFor(1400, prefs);
  expect(l.inspectorVisible).toBe(false);
  expect(l.inspectorWidth).toBeGreaterThanOrEqual(360);
  expect(l.inspectorWidth).toBeLessThanOrEqual(480);
});

test('measure cap is ~720; iPad composer caps at half the window', () => {
  expect(layoutFor(REGULAR_MIN_WIDTH, prefs).measureCap).toBe(720);
  expect(layoutFor(REGULAR_MIN_WIDTH, prefs).composerMaxWidth).toBe(
    Math.round(REGULAR_MIN_WIDTH * 0.5),
  );
  expect(layoutFor(390, prefs).composerMaxWidth).toBeUndefined();
});
