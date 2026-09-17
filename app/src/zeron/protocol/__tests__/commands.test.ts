// Ported from zeron@853872d crates/doc/src/commands.rs #[cfg(test)]
// (evaluate_command rule 3 — minus the processed-ledger link the phone
// doesn't have).

import {
  canComposerCancel,
  describeCommand,
  effectiveExpiry,
} from '../commands';
import { COMMAND_DEFAULT_TTL_MS, type SessionCommandEntry } from '../types';

const cmd = (over: Partial<SessionCommandEntry> = {}): SessionCommandEntry => ({
  id: 'cmd-1',
  kind: 'steer',
  payload: { kind: 'steer', prompt: 'x', messageId: 'm1' },
  issuedBy: 'phone-1',
  issuedAt: 1000,
  expiresAt: 1000 + COMMAND_DEFAULT_TTL_MS,
  status: 'pending',
  ...over,
});

describe('describeCommand', () => {
  it('terminal statuses return as stored', () => {
    for (const status of [
      'applied',
      'rejected',
      'expired',
      'superseded',
      'cancelled',
    ] as const) {
      expect(describeCommand(cmd({ status }), { nowMs: 0, entries: [] })).toBe(
        status,
      );
    }
  });

  it('pending past expiry ⇒ expired', () => {
    const e = cmd({ issuedAt: 1000, expiresAt: 5000 });
    expect(describeCommand(e, { nowMs: 4999, entries: [e] })).toBe('pending');
    expect(describeCommand(e, { nowMs: 5000, entries: [e] })).toBe('expired');
    // No expiresAt ⇒ issuedAt + TTL.
    const noExpiry = cmd({ expiresAt: undefined });
    expect(effectiveExpiry(noExpiry)).toBe(1000 + COMMAND_DEFAULT_TTL_MS);
  });

  it('a newer pending same-kind steer/interrupt supersedes; run does not', () => {
    const older = cmd({ id: 'a', kind: 'steer', issuedAt: 1000 });
    const newer = cmd({ id: 'b', kind: 'steer', issuedAt: 2000 });
    expect(
      describeCommand(older, { nowMs: 3000, entries: [older, newer] }),
    ).toBe('superseded');
    expect(
      describeCommand(newer, { nowMs: 3000, entries: [older, newer] }),
    ).toBe('pending');
    // A same-kind entry that already resolved does NOT supersede.
    const resolved = cmd({
      id: 'c',
      kind: 'steer',
      issuedAt: 2500,
      status: 'applied',
    });
    expect(
      describeCommand(older, { nowMs: 3000, entries: [older, resolved] }),
    ).toBe('pending');
    // run commands are not same-kind superseded.
    const run = cmd({
      id: 'r',
      kind: 'run',
      payload: { kind: 'run', request: {} as never, messageId: 'm' },
      issuedAt: 1000,
    });
    const run2 = cmd({
      id: 'r2',
      kind: 'run',
      payload: { kind: 'run', request: {} as never, messageId: 'm2' },
      issuedAt: 2000,
    });
    expect(describeCommand(run, { nowMs: 3000, entries: [run, run2] })).toBe(
      'pending',
    );
  });

  it('interrupt based on a past turn is superseded', () => {
    const e = cmd({
      kind: 'interrupt',
      payload: { kind: 'interrupt' },
      basedOn: { turnId: 't1' },
    });
    expect(
      describeCommand(e, {
        nowMs: 1000,
        entries: [e],
        currentTurnId: 't2',
        turnIsPast: t => t === 't1',
      }),
    ).toBe('superseded');
    // Still the current turn ⇒ pending.
    expect(
      describeCommand(e, {
        nowMs: 1000,
        entries: [e],
        currentTurnId: 't1',
        turnIsPast: () => false,
      }),
    ).toBe('pending');
  });
});

describe('canComposerCancel', () => {
  it('only the issuing device may cancel, and only while pending', () => {
    const e = cmd();
    expect(canComposerCancel(e, 'phone-1')).toBe(true);
    expect(canComposerCancel(e, 'phone-2')).toBe(false);
    expect(canComposerCancel(cmd({ status: 'applied' }), 'phone-1')).toBe(
      false,
    );
  });
});
