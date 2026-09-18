import {
  clamp01,
  getEffortSliderTrackGeometry,
  magnetize,
  nearestStopIndex,
  stopFraction,
  trackXToFraction,
} from '../src/components/effortSliderMath';
import { composerShowsEffort } from '../src/components/modelLabel';
import { patchOnModelPick } from '../src/components/modelPicker';

test('stopFraction is even across the track', () => {
  expect(stopFraction(0, 5)).toBe(0);
  expect(stopFraction(2, 5)).toBe(0.5);
  expect(stopFraction(4, 5)).toBe(1);
  expect(stopFraction(0, 1)).toBe(0);
});

test('nearestStopIndex snaps and clamps', () => {
  expect(nearestStopIndex(0, 4)).toBe(0);
  expect(nearestStopIndex(1, 4)).toBe(3);
  expect(nearestStopIndex(0.5, 5)).toBe(2);
  expect(nearestStopIndex(-1, 3)).toBe(0);
  expect(nearestStopIndex(2, 1)).toBe(0);
});

test('trackXToFraction uses thumb inset travel', () => {
  expect(trackXToFraction(33, 200, 33)).toBe(0);
  expect(trackXToFraction(167, 200, 33)).toBe(1);
  expect(trackXToFraction(100, 200, 33)).toBeCloseTo(0.5, 5);
  expect(trackXToFraction(0, 10, 20)).toBe(0);
});

test('magnetize pulls toward the nearest stop inside the radius', () => {
  const pulled = magnetize(0.12, 5, 0.5);
  expect(pulled).toBeLessThan(0.12);
  expect(magnetize(0, 5, 0.5)).toBe(0);
  expect(magnetize(0.5, 2, 0.5)).toBe(0.5);
  expect(clamp01(2)).toBe(1);
});

test('tick centers share thumb endpoint geometry for 2 and 6 stops', () => {
  const two = getEffortSliderTrackGeometry(280, 2, 36, 15);
  const six = getEffortSliderTrackGeometry(280, 6, 36, 15);
  expect(two.tickCenters[0]).toBe(six.tickCenters[0]);
  expect(two.tickCenters[1]).toBe(six.tickCenters[5]);
  expect(two.travelDistance).toBe(six.travelDistance);
});

test('composerShowsEffort is true only when the catalog advertises levels', () => {
  expect(composerShowsEffort(['low', 'high'])).toBe(true);
  expect(composerShowsEffort([])).toBe(false);
});

test('patchOnModelPick drops a stale effort the new model does not advertise', () => {
  expect(patchOnModelPick('high', 'opus', ['low', 'medium', 'high'])).toEqual({
    model: 'opus',
    reasoning: 'high',
  });
  expect(patchOnModelPick('ultra', 'sonnet', ['low', 'high'])).toEqual({
    model: 'sonnet',
    reasoning: undefined,
  });
});
