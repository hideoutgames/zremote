import {
  layoutFor,
  REGULAR_MIN_WIDTH,
  INSPECTOR_AUTO_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  COMPOSER_MAX_WIDTH,
  COMPOSER_H_GUTTER,
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
  expect(l.sidebarWidth).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
  expect(l.sidebarWidth).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);
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

test('measure cap is ~720; iPad composer caps inside the detail column', () => {
  const regular = layoutFor(REGULAR_MIN_WIDTH, prefs);
  expect(regular.measureCap).toBe(720);
  expect(regular.composerMaxWidth).toBe(
    Math.min(
      COMPOSER_MAX_WIDTH,
      Math.max(
        0,
        REGULAR_MIN_WIDTH - regular.sidebarWidth - COMPOSER_H_GUTTER * 2,
      ),
    ),
  );
  const collapsed = layoutFor(820, { ...prefs, sidebarCollapsed: true });
  expect(collapsed.composerMaxWidth).toBe(
    Math.min(COMPOSER_MAX_WIDTH, 820 - COMPOSER_H_GUTTER * 2),
  );
  expect(layoutFor(390, prefs).composerMaxWidth).toBeUndefined();
});
