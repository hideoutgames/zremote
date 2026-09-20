// Catalog option ids the host uses for Fast mode (claude catalog: fastMode;
// demo fixtures: fast; ACP: fast-mode). Codex advertises Fast as serviceTier
// (or service-tier) with a `fast` choice, not a dedicated fastMode option.

import type { Model, ModelOption } from '../zeron/protocol/types';

export const FAST_OPTION_IDS = ['fast', 'fastMode', 'fast-mode'] as const;

const SERVICE_TIER_IDS = new Set(['serviceTier', 'service-tier']);

const OFF_CHOICES = new Set([
  'off',
  'false',
  '0',
  'no',
  'default',
  'standard',
  'auto',
]);

export const isFastOffChoice = (choice: string | undefined): boolean => {
  if (choice === undefined) return true;
  return OFF_CHOICES.has(choice.toLowerCase());
};

const hasFastChoice = (option: ModelOption): boolean =>
  option.choices.some(c => c.id.toLowerCase() === 'fast');

export const isFastLikeOption = (option: ModelOption): boolean =>
  (FAST_OPTION_IDS as readonly string[]).includes(option.id) ||
  (SERVICE_TIER_IDS.has(option.id) && hasFastChoice(option));

export const findFastOption = (
  options: readonly ModelOption[] | undefined,
): ModelOption | undefined => options?.find(isFastLikeOption);

export const fastOptionForModel = (
  model: Model | undefined,
): ModelOption | undefined => findFastOption(model?.options);

export const isFastEnabled = (
  modelOptions: Record<string, unknown> | undefined,
  option: ModelOption | undefined,
): boolean => {
  if (option === undefined) return false;
  const raw = modelOptions?.[option.id];
  const choice = typeof raw === 'string' ? raw : option.defaultChoice;
  return !isFastOffChoice(choice);
};

export const fastOnChoice = (option: ModelOption): string => {
  const on = option.choices.find(c => !isFastOffChoice(c.id));
  return on?.id ?? option.choices[0]?.id ?? 'on';
};

export const fastOffChoice = (option: ModelOption): string => {
  const off = option.choices.find(c => isFastOffChoice(c.id));
  return off?.id ?? option.defaultChoice;
};
