// Catalog options that select a context window (Claude `contextWindow`,
// Cursor `context`, older `context-window` fixtures). Shown only when the
// model advertises at least two choices.

import type { Model, ModelOption } from '../zeron/protocol/types';
import { normCatalogId } from './modelPicker';

const CONTEXT_OPTION_NORMS = new Set([
  'contextwindow',
  'context',
  'contextlength',
  'contextsize',
  'maxcontext',
]);

export const contextOptionForModel = (
  model: Model | undefined,
): ModelOption | undefined =>
  (model?.options ?? []).find(
    o => CONTEXT_OPTION_NORMS.has(normCatalogId(o.id)) && o.choices.length >= 2,
  );

/** Chip title for a context-window choice: the catalog label, else the id. */
export const contextChoiceLabel = (
  option: ModelOption,
  choiceId: string | undefined,
): string => {
  const choice = option.choices.find(c => c.id === choiceId);
  const label = choice?.label.trim() ?? '';
  if (label !== '') return label;
  if (choiceId !== undefined && choiceId !== '') return choiceId;
  const fallback = option.choices.find(c => c.id === option.defaultChoice);
  const fallbackLabel = fallback?.label.trim() ?? '';
  return fallbackLabel !== '' ? fallbackLabel : option.defaultChoice;
};
