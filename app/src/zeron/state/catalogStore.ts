// Host capability catalog (runtime/catalog.ts loads it over the device
// relay): per-device harnesses + lazily-loaded models. No hardcoded fallbacks
// — filtering happens in catalog.ts (WorkspaceStore.swift rules); this store
// just holds what the host said.

import { createStore } from 'zustand/vanilla';
import type {
  HarnessDescriptor,
  Model,
  ReasoningLevel,
} from '../protocol/types';

export interface DeviceCatalog {
  harnesses: HarnessDescriptor[];
  modelsByHarness: Record<string, Model[]>;
  loading: boolean;
  error?: string;
  loadedAt?: number;
}

export interface CatalogState {
  byDevice: Record<string, DeviceCatalog>;
}

const EMPTY_CATALOG: DeviceCatalog = {
  harnesses: [],
  modelsByHarness: {},
  loading: false,
};

export const catalogStore = createStore<CatalogState>(() => ({
  byDevice: {},
}));

export const setDeviceCatalog = (
  deviceId: string,
  patch: Partial<DeviceCatalog>,
): void => {
  catalogStore.setState(s => ({
    byDevice: {
      ...s.byDevice,
      [deviceId]: { ...EMPTY_CATALOG, ...s.byDevice[deviceId], ...patch },
    },
  }));
};

export const resetCatalog = (): void => {
  catalogStore.setState({ byDevice: {} });
};

// ── Selectors ──────────────────────────────────────────────────────────

const catalogFor = (s: CatalogState, deviceId: string): DeviceCatalog =>
  s.byDevice[deviceId] ?? EMPTY_CATALOG;

/** Harnesses the composer may offer — already filtered by catalog.ts. */
export const selectableHarnesses = (deviceId: string) =>
  catalogFor(catalogStore.getState(), deviceId).harnesses;

export const modelsFor = (deviceId: string, harness: string) =>
  catalogFor(catalogStore.getState(), deviceId).modelsByHarness[harness] ?? [];

/** Effort levels for a model: the model's own list when non-empty, else the
 * harness descriptor's; empty ⇒ effort unsupported. */
export const reasoningLevelsFor = (
  deviceId: string,
  harness: string,
  modelId?: string,
): ReasoningLevel[] => {
  const cat = catalogStore.getState().byDevice[deviceId];
  if (cat === undefined) return [];
  const model = (cat.modelsByHarness[harness] ?? []).find(
    m => m.id === modelId,
  );
  if (model !== undefined && model.reasoningLevels.length > 0)
    return model.reasoningLevels;
  const h = cat.harnesses.find(x => x.id === harness);
  return h?.reasoningLevels ?? [];
};
