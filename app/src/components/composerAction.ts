// Composer button logic as pure functions — unit-tested, used by Composer.
//
// `primary`   — the main action next to the input (Send / Steer / disabled).
// `right`     — the circle button on the right (Send / Stop / Stopping… /
//               Cancel while an own run is parked but the host isn't working).
// `liveAction` — the pill shown while a run is live: Queue when the host has
//               `message-queue-v1`, Steer when the harness steers mid-turn,
//               hidden otherwise (the input shows the busy hint).

import type { HarnessDescriptor } from '../zeron/protocol/types';
import type { RunPhase } from '../zeron/state/sessionStores';
import { CAP_QUEUE } from '../zeron/attachments/sendPlan';

export interface ComposerAction {
  primary: 'send' | 'steer' | 'disabled';
  right: 'send' | 'stop' | 'stopping' | 'cancel';
}

export type LiveAction = 'queue' | 'steer' | 'hidden';

const LIVE_PHASES: ReadonlySet<RunPhase> = new Set([
  'working',
  'awaitingInput',
]);

const PENDING_OWN_RUN_PHASES: ReadonlySet<RunPhase> = new Set([
  'queuedLocally',
  'synchronized',
]);

export const harnessSteers = (
  harness: HarnessDescriptor | undefined,
): boolean =>
  harness?.supportsSteering === true &&
  harness.steeringMode === 'step-boundary';

/**
 * Steering is offered mid-turn only when the harness drives step-boundary
 * steers (supportsSteering && steeringMode === 'step-boundary'); otherwise a
 * live run disables send. While stopping, both sides are inert. While an own
 * run is queued-locally/synchronized (host not yet working) the right button
 * is Cancel → `cancelOwnCommand`.
 */
export const composerAction = (
  phase: RunPhase,
  harness: HarnessDescriptor | undefined,
  hasDraft: boolean,
): ComposerAction => {
  if (phase === 'stopping') return { primary: 'disabled', right: 'stopping' };

  if (LIVE_PHASES.has(phase)) {
    return {
      primary: harnessSteers(harness) && hasDraft ? 'steer' : 'disabled',
      right: 'stop',
    };
  }
  if (PENDING_OWN_RUN_PHASES.has(phase)) {
    return { primary: 'disabled', right: 'cancel' };
  }
  return {
    primary: hasDraft ? 'send' : 'disabled',
    right: 'send',
  };
};

/**
 * The live-run pill: Queue is the default when the host advertises
 * `message-queue-v1`; a persisted preference may switch it to Steer (only
 * when the harness steers mid-turn). Without queue support the pill is
 * Steer-or-hidden (ComposerView.swift ~L300–700).
 */
export const liveAction = (
  phase: RunPhase,
  queueSupported: boolean,
  steerable: boolean,
  prefersSteer: boolean,
): LiveAction => {
  if (!LIVE_PHASES.has(phase)) return 'hidden';
  if (queueSupported) return prefersSteer && steerable ? 'steer' : 'queue';
  return steerable ? 'steer' : 'hidden';
};

export const queueSupported = (capabilities: ReadonlySet<string>): boolean =>
  capabilities.has(CAP_QUEUE);
