// Host catalog loading (WorkspaceStore.swift listHarnesses/listModels +
// the repo/folder relay wrappers, L531–645). Writes into catalogStore.

import { METHODS } from '../protocol/rpc';
import type {
  FolderListing,
  HarnessDescriptor,
  Model,
  RepoRef,
} from '../protocol/types';
import { catalogStore, setDeviceCatalog } from '../state/catalogStore';
import type { AppRuntime } from './appRuntime';

/** Harnesses the composer may offer: `mock` excluded unless the edge config
 * allows it; `installed` defaults true; `enabled` falls back to the engine's
 * default_enabled() pair — matching Swift's `descriptor_enabled`. */
export const filterHarnesses = (
  wire: HarnessDescriptor[],
  allowMock: boolean,
): HarnessDescriptor[] =>
  wire.filter(
    h =>
      (allowMock || h.id !== 'mock') &&
      (h.installed ?? true) &&
      (h.enabled ?? ['claude-code', 'codex'].includes(h.id)),
  );

export const loadCatalog = async (
  runtime: AppRuntime,
  deviceId: string,
  opts: { allowMockHarness?: boolean } = {},
): Promise<void> => {
  setDeviceCatalog(deviceId, { loading: true, error: undefined });
  try {
    const harnesses = await runtime
      .relayFor(deviceId)
      .call<HarnessDescriptor[]>(METHODS.LIST_HARNESSES, {});
    setDeviceCatalog(deviceId, {
      harnesses: filterHarnesses(harnesses, opts.allowMockHarness ?? false),
      loading: false,
      loadedAt: Date.now(),
    });
  } catch (e) {
    setDeviceCatalog(deviceId, { loading: false, error: String(e) });
  }
};

/** Lazily load + cache a harness's models. */
export const loadModels = async (
  runtime: AppRuntime,
  deviceId: string,
  harness: string,
): Promise<Model[] | undefined> => {
  try {
    const models = await runtime
      .relayFor(deviceId)
      .call<Model[]>(METHODS.LIST_MODELS, { harness });
    setDeviceCatalog(deviceId, {
      modelsByHarness: {
        ...(catalogModels(deviceId) ?? {}),
        [harness]: models,
      },
      // Catalog memos (composer menu, picker sheet) key on loadedAt.
      loadedAt: Date.now(),
    });
    return models;
  } catch {
    return undefined;
  }
};

const catalogModels = (deviceId: string) =>
  catalogStore.getState().byDevice[deviceId]?.modelsByHarness;

/** Flips a harness's enablement; the reply IS the fresh catalog. */
export const setHarnessEnabled = async (
  runtime: AppRuntime,
  deviceId: string,
  harness: string,
  enabled: boolean,
  opts: { allowMockHarness?: boolean } = {},
): Promise<void> => {
  const fresh = await runtime
    .relayFor(deviceId)
    .call<HarnessDescriptor[]>(METHODS.SET_HARNESS_ENABLED, {
      harness,
      enabled,
    });
  setDeviceCatalog(deviceId, {
    harnesses: filterHarnesses(fresh, opts.allowMockHarness ?? false),
    loadedAt: Date.now(),
  });
};

export const listFolders = (
  runtime: AppRuntime,
  deviceId: string,
  path?: string,
): Promise<FolderListing | undefined> =>
  runtime
    .relayFor(deviceId)
    .call<FolderListing>(
      METHODS.LIST_FOLDERS,
      path !== undefined ? { path } : {},
    )
    .catch(() => undefined);

export const listRefs = (
  runtime: AppRuntime,
  deviceId: string,
  repoPath: string,
): Promise<RepoRef[] | undefined> =>
  runtime
    .relayFor(deviceId)
    .call<RepoRef[]>(METHODS.LIST_REFS, { repoPath })
    .catch(() => undefined);

/** Returns undefined on success, the git error message on failure. */
export const switchRef = async (
  runtime: AppRuntime,
  deviceId: string,
  repoPath: string,
  refName: string,
): Promise<string | undefined> => {
  try {
    await runtime
      .relayFor(deviceId)
      .call<{ branch?: string }>(METHODS.SWITCH_REF, { repoPath, refName });
    return undefined;
  } catch (e) {
    return String(e);
  }
};

/** CreateWorktree — returns the fresh worktree's path. */
export const createWorktree = (
  runtime: AppRuntime,
  deviceId: string,
  repoPath: string,
  branch: string,
): Promise<string | undefined> =>
  runtime
    .relayFor(deviceId)
    .call<{ path: string }>(METHODS.CREATE_WORKTREE, { repoPath, branch })
    .then(r => r.path)
    .catch(() => undefined);
