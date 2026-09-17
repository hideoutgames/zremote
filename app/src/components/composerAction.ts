// Composer button logic as a pure function — unit-tested, used by Composer.
//
// `primary`  — the main action next to the input (Send / Steer / disabled).
// `right`    — the circle button on the right (Send / Stop / Stopping…).

import type { HarnessDescriptor } from '../zeron/protocol/types';
import type { RunPhase } from '../zeron/state/sessionStores';

export interface ComposerAction {
  primary: 'send' | 'steer' | 'disabled';
  right: 'send' | 'stop' | 'stopping';
}

const LIVE_PHASES: ReadonlySet<RunPhase> = new Set([
  'working',
  'awaitingInput',
]);

/**
 * Steering is offered mid-turn only when the harness drives step-boundary
 * steers (supportsSteering && steeringMode === 'step-boundary'); otherwise a
 * live run disables send. While stopping, both sides are inert.
 */
export const composerAction = (
  phase: RunPhase,
  harness: HarnessDescriptor | undefined,
  hasDraft: boolean,
): ComposerAction => {
  if (phase === 'stopping') return { primary: 'disabled', right: 'stopping' };

  if (LIVE_PHASES.has(phase)) {
    const steers =
      harness?.supportsSteering === true &&
      harness.steeringMode === 'step-boundary';
    return {
      primary: steers && hasDraft ? 'steer' : 'disabled',
      right: 'stop',
    };
  }
  return {
    primary: hasDraft ? 'send' : 'disabled',
    right: 'send',
  };
};
