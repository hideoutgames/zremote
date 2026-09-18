// Discrete effort-slider geometry (Cherry Studio interaction reference,
// reimplemented). Positions are normalized track fractions in [0, 1].

export const effortSliderTrackHeight = 64;
export const effortSliderProgressHeight = 44;
export const effortSliderThumbSize = 36;
export const effortSliderThumbInset = 14;
export const effortSliderTickSize = 10;
export const effortSliderSnapMs = 200;
export const effortSliderMagnetRadius = 0.55;

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

/** Normalized position of a stop. Single-stop tracks collapse to 0. */
export const stopFraction = (index: number, stopCount: number): number => {
  if (stopCount < 2) return 0;
  return clamp01(index / (stopCount - 1));
};

export interface EffortSliderTrackGeometry {
  thumbCenterStart: number;
  tickCenters: number[];
  travelDistance: number;
}

/** Shared geometry so thumb centers and discrete ticks stay aligned. */
export const getEffortSliderTrackGeometry = (
  trackWidth: number,
  stopCount: number,
  thumbSize: number,
  trackPadding: number,
): EffortSliderTrackGeometry => {
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
};

export const nearestStopIndex = (
  fraction: number,
  stopCount: number,
): number => {
  if (stopCount < 2) return 0;
  return Math.round(clamp01(fraction) * (stopCount - 1));
};

/** Maps a touch x-coordinate onto the thumb's inset endpoint travel. */
export const trackXToFraction = (
  x: number,
  trackWidth: number,
  thumbCenterInset: number,
): number => {
  const travelDistance = trackWidth - thumbCenterInset * 2;
  if (travelDistance <= 0) return 0;
  return clamp01((x - thumbCenterInset) / travelDistance);
};

/** Pulls a dragged position toward the nearest stop (smoothstep). */
export const magnetize = (
  fraction: number,
  stopCount: number,
  radius: number,
): number => {
  if (stopCount < 2) return 0;
  const value = clamp01(fraction) * (stopCount - 1);
  const nearest = Math.round(value);
  const delta = value - nearest;
  const distance = Math.abs(delta);
  if (distance < 0.001 || distance > radius) return clamp01(fraction);
  const t = 1 - distance / radius;
  const pull = t * t * (3 - 2 * t);
  return clamp01((value - delta * pull) / (stopCount - 1));
};

export const capitalizeLevel = (s: string): string =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
