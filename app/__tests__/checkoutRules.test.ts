import { checkoutChangeAllowed } from '../src/components/checkoutRules';
import type { DeviceRow } from '../src/zeron/protocol/types';

const host = (version: string): DeviceRow => ({
  id: 'd1',
  name: 'Mac',
  platform: 'macos',
  version,
  capabilities: [],
});

const ref = { kind: 'ref', ref: 'main' } as const;
const wt = { kind: 'newWorktree', base: 'main' } as const;

test('idle + plain ref → allowed', () => {
  expect(checkoutChangeAllowed('idle', ref, host('0.2.72'))).toEqual({
    allowed: true,
  });
});

test('working/awaitingInput/stopping → busy', () => {
  for (const phase of ['working', 'awaitingInput', 'stopping'] as const)
    expect(checkoutChangeAllowed(phase, ref, host('0.2.72'))).toEqual({
      allowed: false,
      reason: 'busy',
    });
});

test('new worktree gated on host ≥ 0.2.62', () => {
  expect(checkoutChangeAllowed('idle', wt, host('0.2.61'))).toEqual({
    allowed: false,
    reason: 'worktreeUnsupported',
  });
  expect(checkoutChangeAllowed('idle', wt, host('0.2.62')).allowed).toBe(true);
  expect(checkoutChangeAllowed('idle', wt, host('0.3.0')).allowed).toBe(true);
});

test('worktree-backed ref choice needs no version gate', () => {
  expect(
    checkoutChangeAllowed(
      'idle',
      { kind: 'ref', ref: 'feature', worktreePath: '/wt' },
      host('0.1.0'),
    ).allowed,
  ).toBe(true);
});
