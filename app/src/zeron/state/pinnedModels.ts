// Pinned models for the full picker and the composer Liquid Glass menu.
// Caps at 10; the composer shows pins instead of recents when any apply.

import {
  recentMenuModels,
  type CatalogModelRef,
  type RecentModel,
} from './recentModels';

export const MAX_PINNED_MODELS = 10;

const same = (a: RecentModel, b: RecentModel): boolean =>
  a.harness === b.harness && a.model === b.model;

const keyOf = (m: RecentModel): string => `${m.harness}\0${m.model}`;

export const isPinnedModel = (
  pinned: readonly RecentModel[],
  pick: RecentModel,
): boolean => pinned.some(p => same(p, pick));

/** Unpin if present; otherwise prepend when under the cap. */
export const togglePinnedModelList = (
  pinned: readonly RecentModel[],
  pick: RecentModel,
  max = MAX_PINNED_MODELS,
): RecentModel[] => {
  if (pinned.some(p => same(p, pick))) {
    return pinned.filter(p => !same(p, pick));
  }
  if (pinned.length >= max) return [...pinned];
  return [pick, ...pinned];
};

/** Catalog-resolved pins in prefs order. Does not inject current or recents. */
export const pinnedMenuModels = (
  pinned: readonly RecentModel[],
  catalog: readonly CatalogModelRef[],
  current: RecentModel | undefined,
  limit = MAX_PINNED_MODELS,
  lockHarness = true,
): CatalogModelRef[] => {
  if (limit <= 0 || catalog.length === 0) return [];
  const byKey = new Map(catalog.map(m => [keyOf(m), m]));
  const currentHarness = lockHarness ? current?.harness : undefined;
  const out: CatalogModelRef[] = [];
  const seen = new Set<string>();
  for (const p of pinned) {
    if (out.length >= limit) break;
    if (currentHarness !== undefined && p.harness !== currentHarness) continue;
    const hit = byKey.get(keyOf(p));
    if (hit === undefined) continue;
    const k = keyOf(hit);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      harness: hit.harness,
      model: hit.model,
      label: hit.label,
      harnessName: hit.harnessName,
    });
  }
  return out;
};

/** Pins (up to 10) when any catalog-visible pin applies; otherwise recents. */
export const composerMenuModels = (
  pinned: readonly RecentModel[],
  recents: readonly RecentModel[],
  catalog: readonly CatalogModelRef[],
  current: RecentModel | undefined,
  lockHarness = true,
): CatalogModelRef[] => {
  const pins = pinnedMenuModels(
    pinned,
    catalog,
    current,
    MAX_PINNED_MODELS,
    lockHarness,
  );
  if (pins.length > 0) return pins;
  return recentMenuModels(recents, catalog, current, 3, lockHarness);
};
