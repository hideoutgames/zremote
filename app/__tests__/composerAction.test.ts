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

test('queuedLocally/synchronized behave like idle for send', () => {
  expect(composerAction('queuedLocally', steers, true).primary).toBe('send');
  expect(composerAction('synchronized', steers, true).primary).toBe('send');
});
