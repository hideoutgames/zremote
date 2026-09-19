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
export const COMPOSER_MAX_FRACTION = 0.5;

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
  return {
    mode: 'regular',
    sidebarVisible: !prefs.sidebarCollapsed,
    inspectorVisible: false,
    sidebarWidth: Math.min(360, Math.max(300, Math.round(width * 0.24))),
    inspectorWidth,
    measureCap: MEASURE_CAP,
    composerMaxWidth: Math.round(width * COMPOSER_MAX_FRACTION),
  };
};
