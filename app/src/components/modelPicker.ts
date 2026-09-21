// Pure helpers for ModelPickerSheet — effort-detent math and catalog
// revalidation, unit-tested without a view.

import type { ChatConfig, Model } from '../zeron/protocol/types';

export const modelRowKey = (harness: string, modelId: string): string =>
  `${harness}:${modelId}`;

/** Host `norm_id`: alphanumeric, lowercased (`fastMode` == `fast-mode`). */
export const normCatalogId = (id: string): string =>
  id.replace(/[^0-9A-Za-z]/g, '').toLowerCase();

/** Last-used effort / Fast for one catalog model (persisted in uiPrefs). */
export interface ModelSettings {
  reasoning?: string;
  modelOptions?: Record<string, unknown>;
}

/** Prefer a remembered (or live) level when it is still on the ladder. */
export const rememberedReasoning = (
  stored: ModelSettings | undefined,
  levels: readonly string[],
  live?: string,
): string | undefined => {
  const candidate = live ?? stored?.reasoning;
  if (candidate !== undefined && levels.includes(candidate)) return candidate;
  return levels[0];
};

/** Options advertised by the current catalog model — never leak another
 * model's modelOptions keys across a pick. */
export const rememberedModelOptions = (
  stored: ModelSettings | undefined,
  options: readonly { id: string; defaultChoice: string }[] | undefined,
  live?: Record<string, unknown>,
): Record<string, unknown> => {
  if (options === undefined || options.length === 0) return {};
  const source = live ?? stored?.modelOptions;
  const out: Record<string, unknown> = {};
  for (const option of options) {
    const raw = source?.[option.id];
    out[option.id] = typeof raw === 'string' ? raw : option.defaultChoice;
  }
  return out;
};

/** A model's own ladder when non-empty, else the harness's advertised list. */
export const effortLevelsForModel = (
  model: Pick<Model, 'reasoningLevels'>,
  harnessLevels: readonly string[] | undefined,
): string[] =>
  model.reasoningLevels.length > 0
    ? [...model.reasoningLevels]
    : [...(harnessLevels ?? [])];

/** Ordered detents = the harness's advertised reasoning levels, exactly as
 * the catalog returns them (capitalized for display only — the wire value is
 * the raw level). */
export const effortDetents = (levels: readonly string[]): string[] => [
  ...levels,
];

/** Index of `value` in `levels` (0 when unset/unknown — the first detent is
 * the model's default). */
export const detentForValue = (
  levels: readonly string[],
  value: string | undefined | null,
): number => {
  if (value == null) return 0;
  const i = levels.indexOf(value);
  return i < 0 ? 0 : i;
};

/** Nearest detent for an x offset across `width` with `count` stops. */
export const nearestDetent = (
  x: number,
  width: number,
  count: number,
): number => {
  if (count <= 1 || width <= 0) return 0;
  const step = width / (count - 1);
  return Math.min(Math.max(Math.round(x / step), 0), count - 1);
};

export interface SelectionHealth {
  agentOk: boolean;
  modelOk: boolean;
  effortOk: boolean;
}

/** Whether the chat's saved config still resolves against the host's
 * catalog — a missing model shows "Unavailable on this host", it is never
 * silently replaced. */
export const revalidateSelection = (
  config: Pick<ChatConfig, 'harness' | 'model' | 'reasoning'> | undefined,
  catalog: {
    selectableHarnessIds: readonly string[];
    models: readonly Model[];
    reasoningLevels: readonly string[];
  },
): SelectionHealth => {
  const harness = config?.harness;
  const agentOk =
    harness === undefined || catalog.selectableHarnessIds.includes(harness);
  const modelOk =
    config?.model == null || catalog.models.some(m => m.id === config.model);
  const effortOk =
    config?.reasoning == null ||
    catalog.reasoningLevels.includes(config.reasoning);
  return { agentOk, modelOk, effortOk };
};
