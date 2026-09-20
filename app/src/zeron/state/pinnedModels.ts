// Pinned models for the full picker and the composer Liquid Glass menu.
// The composer shows pins instead of recents when any catalog-visible pin applies.

import {
  recentMenuModels,
  type CatalogModelRef,
  type RecentModel,
} from './recentModels';

const same = (a: RecentModel, b: RecentModel): boolean =>
  a.harness === b.harness && a.model === b.model;

const keyOf = (m: RecentModel): string => `${m.harness}\0${m.model}`;

export const isPinnedModel = (
  pinned: readonly RecentModel[],
  pick: RecentModel,
): boolean => pinned.some(p => same(p, pick));

/** Unpin if present; otherwise prepend. */
export const togglePinnedModelList = (
  pinned: readonly RecentModel[],
  pick: RecentModel,
): RecentModel[] => {
  if (pinned.some(p => same(p, pick))) {
    return pinned.filter(p => !same(p, pick));
  }
  return [pick, ...pinned];
};

/** Catalog-resolved pins in prefs order. Does not inject current or recents. */
export const pinnedMenuModels = (
  pinned: readonly RecentModel[],
  catalog: readonly CatalogModelRef[],
  current: RecentModel | undefined,
  lockHarness = true,
): CatalogModelRef[] => {
  if (catalog.length === 0) return [];
  const byKey = new Map(catalog.map(m => [keyOf(m), m]));
  const currentHarness = lockHarness ? current?.harness : undefined;
  const out: CatalogModelRef[] = [];
  const seen = new Set<string>();
  for (const p of pinned) {
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

export interface ProviderMenuGroup {
  harness: string;
  label: string;
  items: CatalogModelRef[];
}

/** Bucket menu items by harness; group order follows first appearance. */
export const groupMenuModelsByProvider = (
  items: readonly CatalogModelRef[],
): ProviderMenuGroup[] => {
  const groups: ProviderMenuGroup[] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    let i = index.get(item.harness);
    if (i === undefined) {
      i = groups.length;
      index.set(item.harness, i);
      groups.push({
        harness: item.harness,
        label:
          item.harnessName !== undefined && item.harnessName !== ''
            ? item.harnessName
            : item.harness,
        items: [item],
      });
    } else {
      groups[i].items.push(item);
    }
  }
  return groups;
};

/** Pins when any catalog-visible pin applies; otherwise recents. */
export const composerMenuModels = (
  pinned: readonly RecentModel[],
  recents: readonly RecentModel[],
  catalog: readonly CatalogModelRef[],
  current: RecentModel | undefined,
  lockHarness = true,
): CatalogModelRef[] => {
  const pins = pinnedMenuModels(pinned, catalog, current, lockHarness);
  if (pins.length > 0) return pins;
  return recentMenuModels(recents, catalog, current, 3, lockHarness);
};
