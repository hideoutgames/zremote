import {
  layoutFor,
  REGULAR_MIN_WIDTH,
  INSPECTOR_AUTO_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  COMPOSER_MAX_WIDTH,
  COMPOSER_H_GUTTER,
  MEASURE_CAP,
  columnSideGutter,
  transcriptHorizontalPadding,
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

test('measure cap is min(720, detail − 48); iPad composer caps in the same gutters', () => {
  const regular = layoutFor(REGULAR_MIN_WIDTH, prefs);
  const detail = REGULAR_MIN_WIDTH - regular.sidebarWidth;
  const inner = Math.max(0, detail - COMPOSER_H_GUTTER * 2);
  expect(regular.measureCap).toBe(Math.min(MEASURE_CAP, inner));
  expect(regular.composerMaxWidth).toBe(Math.min(COMPOSER_MAX_WIDTH, inner));
  const collapsed = layoutFor(820, { ...prefs, sidebarCollapsed: true });
  expect(collapsed.measureCap).toBe(
    Math.min(MEASURE_CAP, 820 - COMPOSER_H_GUTTER * 2),
  );
  expect(collapsed.composerMaxWidth).toBe(
    Math.min(COMPOSER_MAX_WIDTH, 820 - COMPOSER_H_GUTTER * 2),
  );
  const wide = layoutFor(1400, prefs);
  const wideInner = Math.max(
    0,
    1400 - wide.sidebarWidth - COMPOSER_H_GUTTER * 2,
  );
  expect(wide.measureCap).toBe(Math.min(MEASURE_CAP, wideInner));
  expect(wide.measureCap).toBe(MEASURE_CAP);
  expect(layoutFor(390, prefs).composerMaxWidth).toBeUndefined();
  expect(layoutFor(390, prefs).measureCap).toBe(MEASURE_CAP);
});

test('columnSideGutter is half the leftover width', () => {
  expect(columnSideGutter(1000, 720)).toBe(140);
  expect(columnSideGutter(684, 720)).toBe(0);
  expect(columnSideGutter(0, 720)).toBe(0);
});

test('transcriptHorizontalPadding keeps equal gutters unless the rail needs more', () => {
  expect(transcriptHorizontalPadding(1000, 720, 0)).toEqual({
    paddingLeft: 140,
    paddingRight: 140,
  });
  expect(transcriptHorizontalPadding(1000, 720, 40)).toEqual({
    paddingLeft: 140,
    paddingRight: 140,
  });
  expect(transcriptHorizontalPadding(390, undefined, 40)).toEqual({
    paddingLeft: 0,
    paddingRight: 40,
  });
  expect(transcriptHorizontalPadding(390, undefined, 0)).toEqual({
    paddingLeft: 0,
    paddingRight: 0,
  });
  expect(transcriptHorizontalPadding(684, 636, 40)).toEqual({
    paddingLeft: 24,
    paddingRight: 40,
  });
});
