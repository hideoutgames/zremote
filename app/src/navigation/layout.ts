// Adaptive layout helper — pure. Regular width ≥ 700pt splits into
// sidebar + detail. The inspector column is retired (`inspectorVisible`
// is always false); tools open from the session overflow menu.

export interface LayoutPrefs {
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
}

export interface LayoutPlan {
  /** compact → existing Home↔Session pager; regular → columns. */
  mode: 'compact' | 'regular';
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  sidebarWidth: number;
  /** inspector width, clamped 360–480. */
  inspectorWidth: number;
  /** transcript measure cap in the detail column. */
  measureCap: number;
  /** Composer stack max width on iPad; omitted on compact (iPhone). */
  composerMaxWidth?: number;
}

export const REGULAR_MIN_WIDTH = 700;
export const INSPECTOR_AUTO_WIDTH = 1100;
export const MEASURE_CAP = 720;
export const SIDEBAR_MIN_WIDTH = 340;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_FRACTION = 0.28;
export const COMPOSER_MAX_WIDTH = 560;
export const COMPOSER_H_GUTTER = 24;

export const layoutFor = (width: number, prefs: LayoutPrefs): LayoutPlan => {
  if (width < REGULAR_MIN_WIDTH) {
    return {
      mode: 'compact',
      sidebarVisible: false,
      inspectorVisible: false,
      sidebarWidth: 0,
      inspectorWidth: 0,
      measureCap: MEASURE_CAP,
    };
  }
  const inspectorWidth = Math.min(480, Math.max(360, Math.round(width * 0.28)));
  const sidebarWidth = Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width * SIDEBAR_FRACTION)),
  );
  const detailWidth = width - (prefs.sidebarCollapsed ? 0 : sidebarWidth);
  return {
    mode: 'regular',
    sidebarVisible: !prefs.sidebarCollapsed,
    inspectorVisible: false,
    sidebarWidth,
    inspectorWidth,
    measureCap: MEASURE_CAP,
    composerMaxWidth: Math.min(
      COMPOSER_MAX_WIDTH,
      Math.max(0, detailWidth - COMPOSER_H_GUTTER * 2),
    ),
  };
};
