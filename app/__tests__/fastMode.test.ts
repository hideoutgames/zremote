import type { ModelOption } from '../src/zeron/protocol/types';
import {
  fastOffChoice,
  fastOnChoice,
  findFastOption,
  isFastEnabled,
  isFastLikeOption,
} from '../src/components/fastMode';

const option = (id: string): ModelOption => ({
  id,
  label: 'Fast mode',
  choices: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  defaultChoice: 'off',
});

const serviceTier = (id = 'serviceTier'): ModelOption => ({
  id,
  label: 'Service Tier',
  choices: [
    { id: 'default', label: 'Standard' },
    { id: 'fast', label: 'Fast' },
  ],
  defaultChoice: 'default',
});

test('findFastOption accepts host id aliases', () => {
  expect(findFastOption([option('fastMode')])?.id).toBe('fastMode');
  expect(findFastOption([option('fast')])?.id).toBe('fast');
  expect(findFastOption([option('fast-mode')])?.id).toBe('fast-mode');
  expect(findFastOption([option('thinking')])).toBeUndefined();
});

test('findFastOption maps Codex serviceTier when a fast choice exists', () => {
  expect(findFastOption([serviceTier()])?.id).toBe('serviceTier');
  expect(findFastOption([serviceTier('service-tier')])?.id).toBe('service-tier');
  expect(
    findFastOption([
      {
        id: 'serviceTier',
        label: 'Service Tier',
        choices: [{ id: 'default', label: 'Standard' }],
        defaultChoice: 'default',
      },
    ]),
  ).toBeUndefined();
  expect(isFastLikeOption(serviceTier())).toBe(true);
  expect(isFastLikeOption(option('thinking'))).toBe(false);
});

test('isFastEnabled reads modelOptions and default', () => {
  const opt = option('fast');
  expect(isFastEnabled({}, opt)).toBe(false);
  expect(isFastEnabled({ fast: 'on' }, opt)).toBe(true);
  expect(isFastEnabled({ fast: 'off' }, opt)).toBe(false);
  expect(isFastEnabled(undefined, undefined)).toBe(false);
});

test('isFastEnabled treats any non-off choice as on', () => {
  const opt: ModelOption = {
    id: 'fast',
    label: 'Fast mode',
    choices: [
      { id: 'off', label: 'Off' },
      { id: 'turbo', label: 'Turbo' },
      { id: 'extra', label: 'Extra' },
    ],
    defaultChoice: 'off',
  };
  expect(isFastEnabled({ fast: 'turbo' }, opt)).toBe(true);
  expect(isFastEnabled({ fast: 'extra' }, opt)).toBe(true);
  expect(isFastEnabled({ fast: 'off' }, opt)).toBe(false);
  expect(isFastEnabled({}, opt)).toBe(false);
});

test('Codex serviceTier default/standard/auto are off', () => {
  const opt = serviceTier();
  expect(isFastEnabled({}, opt)).toBe(false);
  expect(isFastEnabled({ serviceTier: 'default' }, opt)).toBe(false);
  expect(isFastEnabled({ serviceTier: 'standard' }, opt)).toBe(false);
  expect(isFastEnabled({ serviceTier: 'auto' }, opt)).toBe(false);
  expect(isFastEnabled({ serviceTier: 'fast' }, opt)).toBe(true);
  expect(fastOnChoice(opt)).toBe('fast');
  expect(fastOffChoice(opt)).toBe('default');
});

test('on/off choices', () => {
  const opt = option('fast');
  expect(fastOnChoice(opt)).toBe('on');
  expect(fastOffChoice(opt)).toBe('off');
});
