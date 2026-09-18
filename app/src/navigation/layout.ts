// Adaptive layout helper — pure. Regular width ≥ 700pt splits into reserved
// sidebar + detail columns; the inspector is a reserved column only when the
// user opens it (never auto-shown from width).

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
  /** transcript/composer measure cap in the detail column. */
  measureCap: number;
}

export const REGULAR_MIN_WIDTH = 700;
/** Kept for callers/tests; inspector no longer auto-opens at this width. */
export const INSPECTOR_AUTO_WIDTH = 1100;
export const MEASURE_CAP_MIN = 720;
export const MEASURE_CAP_MAX = 1100;
/** @deprecated use MEASURE_CAP_MIN — phone/compact fallback. */
export const MEASURE_CAP = MEASURE_CAP_MIN;

export const layoutFor = (width: number, prefs: LayoutPrefs): LayoutPlan => {
  if (width < REGULAR_MIN_WIDTH) {
    return {
      mode: 'compact',
      sidebarVisible: false,
      inspectorVisible: false,
      sidebarWidth: 0,
      inspectorWidth: 0,
      measureCap: Math.min(MEASURE_CAP_MAX, width),
    };
  }
  const sidebarWidth = Math.min(360, Math.max(300, Math.round(width * 0.24)));
  const inspectorWidth = Math.min(480, Math.max(360, Math.round(width * 0.28)));
  const sidebarVisible = !prefs.sidebarCollapsed;
  const inspectorVisible = prefs.inspectorOpen;
  const occupied =
    (sidebarVisible ? sidebarWidth : 0) +
    (inspectorVisible ? inspectorWidth : 0);
  const detail = Math.max(0, width - occupied);
  return {
    mode: 'regular',
    sidebarVisible,
    inspectorVisible,
    sidebarWidth,
    inspectorWidth,
    measureCap: Math.min(MEASURE_CAP_MAX, detail),
  };
};
