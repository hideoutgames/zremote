import { composerAction } from '../src/components/composerAction';
import type { HarnessDescriptor } from '../src/zeron/protocol/types';

const steers: HarnessDescriptor = {
  id: 'claude-code',
  name: 'Claude Code',
  supportsSteering: true,
  steeringMode: 'step-boundary',
};
const noSteer: HarnessDescriptor = { id: 'codex', name: 'Codex' };

test('idle + draft → send', () => {
  expect(composerAction('idle', steers, true)).toEqual({
    primary: 'send',
    right: 'send',
  });
});

test('idle + empty draft → disabled primary', () => {
  expect(composerAction('idle', steers, false).primary).toBe('disabled');
  expect(composerAction('idle', steers, false).right).toBe('send');
});

test('working + step-boundary harness + draft → steer', () => {
  expect(composerAction('working', steers, true)).toEqual({
    primary: 'steer',
    right: 'stop',
  });
});

test('awaitingInput also steers', () => {
  expect(composerAction('awaitingInput', steers, true).primary).toBe('steer');
});

test('working + no steering support → send disabled, right stop', () => {
  expect(composerAction('working', noSteer, true)).toEqual({
    primary: 'disabled',
    right: 'stop',
  });
});

test('working + steering harness but empty draft → disabled', () => {
  expect(composerAction('working', steers, false).primary).toBe('disabled');
});

test('stopping → both inert', () => {
  expect(composerAction('stopping', steers, true)).toEqual({
    primary: 'disabled',
    right: 'stopping',
  });
});

// ── Stage 6: cancel + live pill ─────────────────────────────────────────

import { liveAction, queueSupported } from '../src/components/composerAction';

test('queuedLocally → right cancel, primary disabled', () => {
  expect(composerAction('queuedLocally', steers, true)).toEqual({
    primary: 'disabled',
    right: 'cancel',
  });
});

test('synchronized → right cancel', () => {
  expect(composerAction('synchronized', noSteer, false).right).toBe('cancel');
});

test('stopping inert (unchanged)', () => {
  expect(composerAction('stopping', steers, true)).toEqual({
    primary: 'disabled',
    right: 'stopping',
  });
});

test('live + queue support → queue by default', () => {
  expect(liveAction('working', true, true, false)).toBe('queue');
});

test('live + queue support + steer pref + steerable → steer', () => {
  expect(liveAction('working', true, true, true)).toBe('steer');
});

test('live + queue support + steer pref but NOT steerable → queue', () => {
  expect(liveAction('working', true, false, true)).toBe('queue');
});

test('live + no queue support + steerable → steer', () => {
  expect(liveAction('awaitingInput', false, true, false)).toBe('steer');
});

test('live + no queue support + not steerable → hidden', () => {
  expect(liveAction('working', false, false, false)).toBe('hidden');
});

test('idle → live pill hidden', () => {
  expect(liveAction('idle', true, true, true)).toBe('hidden');
});

test('working + queue + draft → right send', () => {
  expect(composerAction('working', noSteer, true, true)).toEqual({
    primary: 'disabled',
    right: 'send',
  });
});

test('working + queue + empty draft → stop', () => {
  expect(composerAction('working', steers, false, true)).toEqual({
    primary: 'disabled',
    right: 'stop',
  });
});

test('working + queue + draft + steerable → right send', () => {
  expect(composerAction('working', steers, true, true)).toEqual({
    primary: 'disabled',
    right: 'send',
  });
});

test('queueSupported', () => {
  expect(queueSupported(new Set(['message-queue-v1']))).toBe(true);
  expect(queueSupported(new Set())).toBe(false);
});
