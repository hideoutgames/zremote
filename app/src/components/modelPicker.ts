// Pure helpers for ModelPickerSheet — effort-detent math and catalog
// revalidation, unit-tested without a view.

import type { ChatConfig, Model } from '../zeron/protocol/types';

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

/** Keep the current effort when the new model still advertises it; otherwise
 * drop it so a stale level can't linger. */
export const patchOnModelPick = (
  reasoning: string | undefined,
  modelId: string,
  nextLevels: readonly string[],
): Pick<ChatConfig, 'model' | 'reasoning'> => ({
  model: modelId,
  reasoning:
    reasoning !== undefined && nextLevels.includes(reasoning)
      ? reasoning
      : undefined,
});
