// Checkout-selector rules — pure, unit-tested. Mirrors the desktop branch
// picker / WorkspaceStore.swift setChatCheckout behavior:
//   - switching a plain ref runs `SwitchRef` on the host (git checkout in
//     the chat's cwd — git's own error, e.g. a dirty tree, surfaces) then
//     `setChatCheckout(cwd, branch)`;
//   - choosing a worktree-backed ref retargets to its worktreePath (no git
//     checkout — the path already holds the ref) via
//     `setChatCheckout(worktreePath, ref)`;
//   - "New worktree" issues `CreateWorktree` then the same retarget.
// The selector is disabled while a run is live/stopping ("Stop the run to
// change checkout") and worktree creation needs host ≥
// MIN_VERSION_RUN_WORKTREE.

import type { RunPhase } from '../zeron/state/sessionStores';
import type { DeviceRow } from '../zeron/protocol/types';
import {
  deviceVersionAtLeast,
  MIN_VERSION_RUN_WORKTREE,
} from '../zeron/protocol/entities';

export type CheckoutChoice =
  | { kind: 'ref'; ref: string; worktreePath?: string }
  | { kind: 'newWorktree'; base: string };

export interface CheckoutVerdict {
  allowed: boolean;
  reason?: 'busy' | 'worktreeUnsupported';
}

const BUSY_PHASES: ReadonlySet<RunPhase> = new Set([
  'working',
  'awaitingInput',
  'stopping',
]);

export const checkoutChangeAllowed = (
  phase: RunPhase,
  choice: CheckoutChoice,
  host: DeviceRow | undefined,
): CheckoutVerdict => {
  if (BUSY_PHASES.has(phase)) return { allowed: false, reason: 'busy' };
  if (
    choice.kind === 'newWorktree' &&
    !deviceVersionAtLeast(host, MIN_VERSION_RUN_WORKTREE)
  )
    return { allowed: false, reason: 'worktreeUnsupported' };
  return { allowed: true };
};
