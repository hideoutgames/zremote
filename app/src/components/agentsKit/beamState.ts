// Border-beam state mapping — pure, unit-tested. The visual (Skia stroke
// with a sweeping gradient along the composer perimeter) is driven entirely
// by this function; Reduce Motion collapses motion to a static ring.

import type { RunPhase, RoomState } from '../../zeron/state/sessionStores';

export type BeamMode = 'off' | 'sweep' | 'static' | 'stale' | 'fading';

export interface BeamState {
  mode: BeamMode;
  /** Theme-independent semantic color key — BorderBeam maps it to the
   * active palette. */
  color: 'accent' | 'amber' | 'dim' | 'fading';
  /** Revolutions per second for the sweep; 0 when static. */
  speed: number;
}

const SWEEP_SPEED = 0.5;
const SLOW_SWEEP_SPEED = 0.15;

export const beamState = (
  runPhase: RunPhase,
  roomState: RoomState,
  reduceMotion: boolean,
): BeamState => {
  // A disconnected room overrides everything live-looking.
  if (roomState === 'disconnected' || runPhase === 'stale')
    return { mode: 'stale', color: 'dim', speed: 0 };

  switch (runPhase) {
    case 'working':
      return reduceMotion
        ? { mode: 'static', color: 'accent', speed: 0 }
        : { mode: 'sweep', color: 'accent', speed: SWEEP_SPEED };
    case 'awaitingInput':
      return { mode: 'static', color: 'amber', speed: 0 };
    case 'stopping':
      return reduceMotion
        ? { mode: 'static', color: 'dim', speed: 0 }
        : { mode: 'sweep', color: 'accent', speed: SLOW_SWEEP_SPEED };
    case 'errored':
      return { mode: 'fading', color: 'fading', speed: 0 };
    case 'queuedLocally':
    case 'synchronized':
      return reduceMotion
        ? { mode: 'static', color: 'accent', speed: 0 }
        : { mode: 'sweep', color: 'accent', speed: SLOW_SWEEP_SPEED };
    default:
      return { mode: 'off', color: 'dim', speed: 0 };
  }
};
