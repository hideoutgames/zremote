// activityPhase: runPhase → activity phase; the app-detected question flag
// holds awaitingInput on idle runs (input-part parity) so unbrokered ask
// tools keep the Live Activity on "needs input" instead of completing.

import { activityPhase } from '../activityPhase';

describe('activityPhase', () => {
  it('maps run phases one-to-one without a question', () => {
    expect(activityPhase('working', false, false)).toBe('working');
    expect(activityPhase('awaitingInput', false, false)).toBe('awaitingInput');
    expect(activityPhase('stopping', false, false)).toBe('stopping');
    expect(activityPhase('stale', false, false)).toBe('stale');
    expect(activityPhase('errored', false, false)).toBe('errored');
    expect(activityPhase('idle', false, false)).toBe('completed');
    expect(activityPhase('queuedLocally', false, false)).toBe('working');
    expect(activityPhase('synchronized', false, false)).toBe('working');
  });

  it('shows awaitingInput for an open question on an idle run', () => {
    expect(activityPhase('idle', false, true)).toBe('awaitingInput');
  });

  it('keeps terminal/rare phases authoritative over a stale question', () => {
    expect(activityPhase('stopping', false, true)).toBe('stopping');
    expect(activityPhase('stale', false, true)).toBe('stale');
    expect(activityPhase('errored', false, true)).toBe('errored');
  });

  it('planReady still wins over an open question', () => {
    expect(activityPhase('idle', true, true)).toBe('planReady');
  });
});
