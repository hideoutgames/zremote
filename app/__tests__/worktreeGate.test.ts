// The new-worktree checkout is gated on the host honoring
// `RunRequest.worktree` — WorktreeSpec landed in 0a80fc15 (PR #216), first
// tagged release v0.2.62 (v0.2.61 lacks it). Hosts below must be blocked so
// a run never silently executes in the main checkout.

import {
  deviceVersionAtLeast,
  MIN_VERSION_RUN_WORKTREE,
} from '../src/zeron/protocol/entities';
import type { DeviceRow } from '../src/zeron/protocol/types';

const device = (version?: string): DeviceRow => ({
  id: 'd1',
  name: 'host',
  platform: 'windows',
  capabilities: [],
  version,
});

test('gate version is 0.2.62', () => {
  expect(MIN_VERSION_RUN_WORKTREE).toEqual([0, 2, 62]);
});

test('hosts below the gate are blocked', () => {
  expect(deviceVersionAtLeast(device('0.2.61'), MIN_VERSION_RUN_WORKTREE)).toBe(
    false,
  );
  expect(deviceVersionAtLeast(device('0.2.0'), MIN_VERSION_RUN_WORKTREE)).toBe(
    false,
  );
  expect(deviceVersionAtLeast(device('0.1.99'), MIN_VERSION_RUN_WORKTREE)).toBe(
    false,
  );
  // No version reported → can't prove support → blocked.
  expect(deviceVersionAtLeast(device(), MIN_VERSION_RUN_WORKTREE)).toBe(false);
});

test('hosts at/above the gate are allowed', () => {
  expect(deviceVersionAtLeast(device('0.2.62'), MIN_VERSION_RUN_WORKTREE)).toBe(
    true,
  );
  expect(deviceVersionAtLeast(device('0.2.72'), MIN_VERSION_RUN_WORKTREE)).toBe(
    true,
  );
  expect(deviceVersionAtLeast(device('0.3.0'), MIN_VERSION_RUN_WORKTREE)).toBe(
    true,
  );
  expect(deviceVersionAtLeast(device('1.0.0'), MIN_VERSION_RUN_WORKTREE)).toBe(
    true,
  );
});
