import {
  clamp01,
  getEffortSliderTrackGeometry,
  magnetize,
  nearestStopIndex,
  stopFraction,
  trackXToFraction,
} from '../src/components/effortSliderMath';

test('stopFraction is even across the track', () => {
  expect(stopFraction(0, 5)).toBe(0);
  expect(stopFraction(2, 5)).toBe(0.5);
  expect(stopFraction(4, 5)).toBe(1);
  expect(stopFraction(0, 1)).toBe(0);
});

test('nearestStopIndex snaps and clamps', () => {
  expect(nearestStopIndex(0, 4)).toBe(0);
  expect(nearestStopIndex(0.5, 3)).toBe(1);
  expect(nearestStopIndex(1, 5)).toBe(4);
  expect(nearestStopIndex(2, 3)).toBe(2);
});

test('track geometry aligns ticks with thumb travel', () => {
  const geo = getEffortSliderTrackGeometry(200, 3, 36, 14);
  expect(geo.tickCenters).toHaveLength(3);
  expect(geo.tickCenters[0]).toBe(geo.thumbCenterStart);
  expect(geo.tickCenters[2]).toBe(geo.thumbCenterStart + geo.travelDistance);
});

test('magnetize pulls toward the nearest stop inside the radius', () => {
  const raw = 0.5 + 0.02;
  const pulled = magnetize(raw, 3, 0.55);
  expect(pulled).toBeGreaterThan(0.5);
  expect(pulled).toBeLessThan(raw);
  expect(clamp01(-1)).toBe(0);
  expect(trackXToFraction(14 + 18, 200, 32)).toBeGreaterThanOrEqual(0);
});
