import { beamState } from '../src/components/agentsKit/beamState';

test('working → accent sweep', () => {
  const s = beamState('working', 'caughtUp', false);
  expect(s.mode).toBe('sweep');
  expect(s.color).toBe('accent');
  expect(s.speed).toBeGreaterThan(0);
});

test('awaitingInput → static amber', () => {
  expect(beamState('awaitingInput', 'caughtUp', false)).toEqual({
    mode: 'static',
    color: 'amber',
    speed: 0,
  });
});

test('stale or disconnected → dim stale ring', () => {
  expect(beamState('stale', 'caughtUp', false).mode).toBe('stale');
  expect(beamState('working', 'disconnected', false).mode).toBe('stale');
  expect(beamState('working', 'disconnected', false).color).toBe('dim');
});

test('stopping → slowed sweep', () => {
  const s = beamState('stopping', 'caughtUp', false);
  expect(s.mode).toBe('sweep');
  expect(s.speed).toBeLessThan(beamState('working', 'caughtUp', false).speed);
});

test('errored → fading', () => {
  expect(beamState('errored', 'caughtUp', false).mode).toBe('fading');
});

test('idle → off', () => {
  expect(beamState('idle', 'caughtUp', false).mode).toBe('off');
});

test('reduceMotion collapses sweeps to a static ring', () => {
  expect(beamState('working', 'caughtUp', true).mode).toBe('static');
  expect(beamState('stopping', 'caughtUp', true).mode).toBe('static');
});
