// Catalog option ids the host uses for Fast mode (claude catalog: fastMode;
// demo fixtures: fast; ACP: fast-mode).

import type { Model, ModelOption } from '../zeron/protocol/types';

export const FAST_OPTION_IDS = ['fast', 'fastMode', 'fast-mode'] as const;

const OFF_CHOICES = new Set(['off', 'false', '0', 'no']);

export const isFastOffChoice = (choice: string | undefined): boolean => {
  if (choice === undefined) return true;
  return OFF_CHOICES.has(choice.toLowerCase());
};

export const findFastOption = (
  options: readonly ModelOption[] | undefined,
): ModelOption | undefined =>
  options?.find(o => (FAST_OPTION_IDS as readonly string[]).includes(o.id));

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
