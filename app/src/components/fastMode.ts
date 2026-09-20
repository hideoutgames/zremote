// Catalog option ids the host uses for Fast mode (claude catalog: fastMode;
// ACP: fast-mode). Codex advertises Fast as serviceTier
// (or service-tier) with a `fast` choice, not a dedicated fastMode option.

import type {
  Model,
  ModelOption,
  ModelOptionChoice,
} from '../zeron/protocol/types';
import { t } from '../i18n/strings';

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

const GENERIC_ON_LABELS = new Set(['on', 'true', 'yes', '1']);
const GENERIC_OFF_LABELS = new Set(['off', 'false', 'no', '0']);

/** Menu title for a Fast catalog choice: off-like ids are always Normal. */
export const fastChoiceLabel = (choice: ModelOptionChoice): string => {
  if (isFastOffChoice(choice.id)) return t('picker.fastNormal');
  const label = choice.label.trim();
  if (
    label === '' ||
    GENERIC_ON_LABELS.has(label.toLowerCase()) ||
    GENERIC_OFF_LABELS.has(label.toLowerCase())
  ) {
    return t('picker.fast');
  }
  return choice.label;
};

/** Fast dropdown items: provider names for on-like choices, Normal for off. */
export const fastMenuItems = (
  option?: ModelOption,
): { id: string; label: string }[] => {
  if (option === undefined) {
    return [
      { id: 'on', label: t('picker.fast') },
      { id: 'off', label: t('picker.fastNormal') },
    ];
  }
  if (option.choices.length > 2) {
    return option.choices.map(c => ({
      id: c.id,
      label: fastChoiceLabel(c),
    }));
  }
  const on = option.choices.find(c => !isFastOffChoice(c.id));
  const off = option.choices.find(c => isFastOffChoice(c.id));
  return [
    {
      id: on?.id ?? fastOnChoice(option),
      label: on !== undefined ? fastChoiceLabel(on) : t('picker.fast'),
    },
    {
      id: off?.id ?? fastOffChoice(option),
      label: t('picker.fastNormal'),
    },
  ];
};
