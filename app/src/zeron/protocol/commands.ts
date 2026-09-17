// Ported from zeron@853872d crates/doc/src/commands.rs (rules 2 and 3 —
// the phone has no processed-ledger, so `describeCommand` is a display
// evaluator that mirrors evaluate_command minus the is_processed check).

import type { SessionCommandEntry, SessionCommandStatus } from './types';
import { COMMAND_DEFAULT_TTL_MS } from './types';

/** Effective expiry: explicit `expiresAt`, else `issuedAt + TTL`. */
export const effectiveExpiry = (entry: SessionCommandEntry): number =>
  entry.expiresAt ?? entry.issuedAt + COMMAND_DEFAULT_TTL_MS;

/** Rule 2: only the composer that issued a still-pending command may cancel it. */
export const canComposerCancel = (
  entry: SessionCommandEntry,
  deviceId: string,
): boolean => entry.status === 'pending' && entry.issuedBy === deviceId;

export interface DescribeContext {
  nowMs: number;
  /** All command entries in doc order (used to find newer same-kind entries). */
  entries: readonly SessionCommandEntry[];
  /** The id of the turn currently (or most recently) running, if any. */
  currentTurnId?: string | null;
  /** True when the given turn id has already completed. */
  turnIsPast?: (turnId: string) => boolean;
}

export type CommandDisplayStatus =
  | 'pending'
  | 'expired'
  | 'superseded'
  | SessionCommandStatus;

/**
 * Display-time evaluation of a command entry — mirrors rule 3 of
 * `evaluate_command` (minus `is_processed`: the phone has no processed
 * ledger, and non-persisted supersession/expiry must still render).
 * Terminal statuses return as stored; `pending` entries are re-evaluated.
 */
export const describeCommand = (
  entry: SessionCommandEntry,
  cx: DescribeContext,
): CommandDisplayStatus => {
  if (entry.status !== 'pending') return entry.status;
  if (cx.nowMs >= effectiveExpiry(entry)) return 'expired';
  const kind = entry.kind;
  if (kind === 'steer' || kind === 'interrupt') {
    const hasNewerSameKind = cx.entries.some(
      other =>
        other.id !== entry.id &&
        other.kind === kind &&
        other.status === 'pending' &&
        other.issuedAt > entry.issuedAt,
    );
    if (hasNewerSameKind) return 'superseded';
  }
  if (kind === 'interrupt' && entry.basedOn?.turnId) {
    const turnId = entry.basedOn.turnId;
    const isCurrent = cx.currentTurnId === turnId;
    if (!isCurrent && (cx.turnIsPast?.(turnId) ?? false)) return 'superseded';
  }
  return 'pending';
};
