// Live Activity phase mapping — pure (no expo-widgets) so Jest covers it.
// A detected tool/text question on an idle run still means the agent is
// blocked on the user — the same parity host `input` parts already get
// (runPhase holds awaitingInput for them regardless of run state). Ending
// the activity as "completed" while an open question sits in the panel is
// why live activities "didn't work" for unbrokered ask tools.

import type { SessionActivityPhase } from './SessionActivity';
import type { RunPhase } from '../zeron/state/sessionStores';

export const activityPhase = (
  phase: RunPhase,
  planReady: boolean,
  questionOpen: boolean,
): SessionActivityPhase => {
  if (planReady) return 'planReady';
  switch (phase) {
    case 'awaitingInput':
      return 'awaitingInput';
    case 'stopping':
      return 'stopping';
    case 'stale':
      return 'stale';
    case 'errored':
      return 'errored';
    case 'idle':
      return questionOpen ? 'awaitingInput' : 'completed';
    default:
      return 'working';
  }
};
