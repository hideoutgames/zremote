import type { ModelOption } from '../src/zeron/protocol/types';
import {
  fastOffChoice,
  fastOnChoice,
  findFastOption,
  isFastEnabled,
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

test('findFastOption accepts host id aliases', () => {
  expect(findFastOption([option('fastMode')])?.id).toBe('fastMode');
  expect(findFastOption([option('fast')])?.id).toBe('fast');
  expect(findFastOption([option('fast-mode')])?.id).toBe('fast-mode');
  expect(findFastOption([option('thinking')])).toBeUndefined();
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
      { id: 'standard', label: 'Standard' },
      { id: 'extra', label: 'Extra' },
    ],
    defaultChoice: 'off',
  };
  expect(isFastEnabled({ fast: 'standard' }, opt)).toBe(true);
  expect(isFastEnabled({ fast: 'extra' }, opt)).toBe(true);
  expect(isFastEnabled({ fast: 'off' }, opt)).toBe(false);
  expect(isFastEnabled({}, opt)).toBe(false);
});

test('on/off choices', () => {
  const opt = option('fast');
  expect(fastOnChoice(opt)).toBe('on');
  expect(fastOffChoice(opt)).toBe('off');
});
