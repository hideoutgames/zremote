// Pure slider math ported from Cherry Studio's effortSlider (commit
// 11069639796e9d6d7a0ad8e1369675b841f9d9fb). Positions are normalized
// track fractions in [0, 1]; stops are evenly spaced along the track.

export const effortSliderMagnetRadius = 0.5;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Normalized position of a stop. Single-stop tracks collapse to 0. */
export function stopFraction(index: number, stopCount: number): number {
  if (stopCount < 2) return 0;
  return clamp01(index / (stopCount - 1));
}

export type EffortSliderTrackGeometry = {
  thumbCenterStart: number;
  tickCenters: number[];
  travelDistance: number;
};

/** Shared geometry that keeps thumb centers and discrete ticks pixel-aligned. */
export function getEffortSliderTrackGeometry(
  trackWidth: number,
  stopCount: number,
  thumbSize: number,
  trackPadding: number,
): EffortSliderTrackGeometry {
  const travelDistance = Math.max(trackWidth - thumbSize - trackPadding * 2, 0);
  const thumbCenterStart = trackPadding + thumbSize / 2;
  const tickCenters =
    stopCount > 0
      ? Array.from(
          { length: stopCount },
          (_, index) =>
            thumbCenterStart + travelDistance * stopFraction(index, stopCount),
        )
      : [];
  return { thumbCenterStart, tickCenters, travelDistance };
}

export function nearestStopIndex(fraction: number, stopCount: number): number {
  if (stopCount < 2) return 0;
  return Math.round(clamp01(fraction) * (stopCount - 1));
}

/** Maps a touch x-coordinate onto the thumb's inset endpoint travel. */
export function trackXToFraction(
  x: number,
  trackWidth: number,
  thumbCenterInset: number,
): number {
  const travelDistance = trackWidth - thumbCenterInset * 2;
  if (travelDistance <= 0) return 0;
  return clamp01((x - thumbCenterInset) / travelDistance);
}

/**
 * Pulls a dragged position toward the nearest stop. No effect beyond `radius`
 * (in stop units); within it the pull ramps up on a smoothstep.
 */
export function magnetize(
  fraction: number,
  stopCount: number,
  radius: number,
): number {
  if (stopCount < 2) return 0;
  const value = clamp01(fraction) * (stopCount - 1);
  const nearest = Math.round(value);
  const delta = value - nearest;
  const distance = Math.abs(delta);
  if (distance < 0.001 || distance > radius) return clamp01(fraction);
  const t = 1 - distance / radius;
  const pull = t * t * (3 - 2 * t);
  return clamp01((value - delta * pull) / (stopCount - 1));
}

export const effortSliderTrackHeight = 64;
export const effortSliderProgressHeight = 44;
export const effortSliderThumbSize = 36;
export const effortSliderThumbInset = 15;
export const effortSliderTickSize = 10;
