// Plan-ready Live Activity: last assistant entry carries a plan artifact,
// the session is idle, and the user has not sent a message after it.

import { detectPlanArtifact } from '../components/transcript/detectPlan';
import type { MessageEntry } from '../zeron/protocol/types';
import type { RunPhase } from '../zeron/state/sessionStores';

export const planAwaitingReview = (
  entries: readonly MessageEntry[],
  phase: RunPhase,
): boolean => {
  if (phase !== 'idle') return false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.role === 'user') return false;
    if (entry.role === 'assistant')
      return detectPlanArtifact(entry) !== undefined;
  }
  return false;
};
