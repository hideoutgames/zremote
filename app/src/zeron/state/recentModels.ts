// Recent-model menu: persist last picks and always fill up to 3 slots
// from the host catalog (current selection, then same harness, then others).

export interface RecentModel {
  harness: string;
  model: string;
}

export interface CatalogModelRef extends RecentModel {
  label: string;
}

const same = (a: RecentModel, b: RecentModel): boolean =>
  a.harness === b.harness && a.model === b.model;

const keyOf = (m: RecentModel): string => `${m.harness}\0${m.model}`;

/** Push `pick` to the front of the recents list, dropping duplicates. */
export const rememberRecentModel = (
  recents: readonly RecentModel[],
  pick: RecentModel,
  max = 20,
): RecentModel[] => {
  const next = [pick, ...recents.filter(r => !same(r, pick))];
  return next.slice(0, max);
};

/** Up to `limit` models for the composer's Liquid Glass menu. Recents that
 * still exist in the catalog come first; empty recents still fill from the
 * catalog so the menu is never blank when models are available. */
export const recentMenuModels = (
  recents: readonly RecentModel[],
  catalog: readonly CatalogModelRef[],
  current: RecentModel | undefined,
  limit = 3,
): CatalogModelRef[] => {
  if (limit <= 0 || catalog.length === 0) return [];
  const byKey = new Map(catalog.map(m => [keyOf(m), m]));
  const out: CatalogModelRef[] = [];
  const seen = new Set<string>();
  const add = (ref: RecentModel | undefined): void => {
    if (ref === undefined || out.length >= limit) return;
    const hit = byKey.get(keyOf(ref));
    if (hit === undefined) return;
    const k = keyOf(hit);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(hit);
  };

  add(current);
  for (const r of recents) add(r);

  const currentHarness = current?.harness ?? recents[0]?.harness;
  for (const m of catalog) {
    if (currentHarness !== undefined && m.harness !== currentHarness) continue;
    add(m);
  }
  for (const m of catalog) add(m);
  return out;
};
