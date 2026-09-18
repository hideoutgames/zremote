// Adaptive layout helper — pure. Regular width ≥ 700pt splits into
// sidebar + detail; the inspector appears at ≥ 1100pt or when toggled.

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
export const INSPECTOR_AUTO_WIDTH = 1100;
export const MEASURE_CAP = 720;

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
    inspectorVisible: width >= INSPECTOR_AUTO_WIDTH || prefs.inspectorOpen,
    sidebarWidth: Math.min(360, Math.max(300, Math.round(width * 0.24))),
    inspectorWidth,
    measureCap: MEASURE_CAP,
  };
};
