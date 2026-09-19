// Compact Home↔Session back gesture: only a leading-edge horizontal pan
// commits, matching iOS interactive-pop width rather than full-page paging.

export const EDGE_BACK_WIDTH = 24;
export const EDGE_BACK_DISTANCE = 80;
/** PanResponder `vx` is px per millisecond. */
export const EDGE_BACK_FLICK = 0.55;
const EDGE_MOVE_DX = 8;
const EDGE_MOVE_SLOPE = 1.2;
const EDGE_FLICK_MIN_DX = 28;

export const isEdgeStart = (
  x: number,
  edgeWidth: number = EDGE_BACK_WIDTH,
): boolean => x >= 0 && x <= edgeWidth;

export const isHorizontalEdgeMove = (dx: number, dy: number): boolean =>
  dx > EDGE_MOVE_DX && Math.abs(dx) > Math.abs(dy) * EDGE_MOVE_SLOPE;

export const shouldCommitEdgeBack = (
  translationX: number,
  velocityX: number,
  distance: number = EDGE_BACK_DISTANCE,
  flick: number = EDGE_BACK_FLICK,
): boolean =>
  translationX >= distance ||
  (translationX >= EDGE_FLICK_MIN_DX && velocityX >= flick);
