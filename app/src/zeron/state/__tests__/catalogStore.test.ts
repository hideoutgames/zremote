// Catalog filtering (WorkspaceStore.swift listHarnesses rules) + effort-level
// resolution — no hardcoded fallbacks.

import {
  catalogStore,
  resetCatalog,
  setDeviceCatalog,
  reasoningLevelsFor,
} from '../catalogStore';
import {
  filterHarnesses,
  loadCatalog,
  loadModels,
} from '../../runtime/catalog';
import type { AppRuntime } from '../../runtime/appRuntime';
import type { HarnessDescriptor, Model } from '../../protocol/types';
import { METHODS } from '../../protocol/rpc';

const harness = (over: Partial<HarnessDescriptor>): HarnessDescriptor => ({
  id: 'h',
  name: 'H',
  ...over,
});

const model = (id: string, reasoningLevels: string[] = []): Model => ({
  id,
  label: id,
  reasoningLevels,
  options: [],
});

const WIRE: HarnessDescriptor[] = [
  harness({ id: 'claude-code' }),
  harness({ id: 'codex' }),
  harness({ id: 'mock', enabled: true }),
  harness({ id: 'gone', installed: false }),
  harness({ id: 'off', enabled: false }),
];

const fakeRuntime = (replies: Record<string, unknown>): AppRuntime =>
  ({
    relayFor: () => ({
      call: async (method: string, params: unknown) => {
        const r = replies[method];
        if (typeof r === 'function') return r(params);
        if (r instanceof Error) throw r;
        return r;
      },
    }),
  } as unknown as AppRuntime);

describe('catalogStore', () => {
  beforeEach(resetCatalog);

  it('excludes mock unless allowed, uninstalled, and disabled; enabled falls back to the default pair', () => {
    const filtered = filterHarnesses(WIRE, false).map(h => h.id);
    expect(filtered).toEqual(['claude-code', 'codex']);
    expect(filterHarnesses(WIRE, true).map(h => h.id)).toContain('mock');
    // enabled:true on a non-default id is kept.
    const custom = filterHarnesses(
      [harness({ id: 'other', enabled: true })],
      false,
    ).map(h => h.id);
    expect(custom).toEqual(['other']);
  });

  it('loadCatalog writes filtered harnesses into the store', async () => {
    await loadCatalog(fakeRuntime({ [METHODS.LIST_HARNESSES]: WIRE }), 'dev1');
    const cat = catalogStore.getState().byDevice.dev1;
    expect(cat.loading).toBe(false);
    expect(cat.harnesses.map(h => h.id)).toEqual(['claude-code', 'codex']);
    expect(cat.loadedAt).toBeGreaterThan(0);
  });

  it('loadCatalog with allowMockHarness keeps the mock harness', async () => {
    await loadCatalog(fakeRuntime({ [METHODS.LIST_HARNESSES]: WIRE }), 'dev1', {
      allowMockHarness: true,
    });
    expect(
      catalogStore.getState().byDevice.dev1.harnesses.map(h => h.id),
    ).toContain('mock');
  });

  it('loadCatalog records the error on relay failure', async () => {
    await loadCatalog(
      fakeRuntime({ [METHODS.LIST_HARNESSES]: new Error('down') }),
      'dev1',
    );
    const cat = catalogStore.getState().byDevice.dev1;
    expect(cat.loading).toBe(false);
    expect(cat.error).toContain('down');
  });

  it('loadModels caches models under the harness', async () => {
    setDeviceCatalog('dev1', { harnesses: [harness({ id: 'mock' })] });
    const models = [model('m1', ['low', 'high'])];
    const out = await loadModels(
      fakeRuntime({ [METHODS.LIST_MODELS]: models }),
      'dev1',
      'mock',
    );
    expect(out).toEqual(models);
    expect(catalogStore.getState().byDevice.dev1.modelsByHarness.mock).toEqual(
      models,
    );
  });

  it('reasoningLevelsFor: model list wins, else harness list, else unsupported', () => {
    setDeviceCatalog('dev1', {
      harnesses: [
        harness({ id: 'h1', reasoningLevels: ['h-low'] }),
        harness({ id: 'h2' }),
      ],
      modelsByHarness: {
        h1: [model('m1'), model('m2', ['m-high'])],
        h2: [model('m3')],
      },
    });
    // Model's own non-empty list wins.
    expect(reasoningLevelsFor('dev1', 'h1', 'm2')).toEqual(['m-high']);
    // Empty model list falls back to the harness descriptor.
    expect(reasoningLevelsFor('dev1', 'h1', 'm1')).toEqual(['h-low']);
    // Both empty ⇒ unsupported.
    expect(reasoningLevelsFor('dev1', 'h2', 'm3')).toEqual([]);
    expect(reasoningLevelsFor('dev1', 'missing')).toEqual([]);
  });

  it('catalogStore holds only host-reported data', async () => {
    await loadCatalog(fakeRuntime({ [METHODS.LIST_HARNESSES]: WIRE }), 'dev1');
    expect(
      catalogStore.getState().byDevice.dev1.harnesses.map(h => h.id),
    ).toEqual(['claude-code', 'codex']);
    // Unknown device ⇒ empty, never a fabricated default.
    expect(catalogStore.getState().byDevice.nobody).toBeUndefined();
    expect(reasoningLevelsFor('nobody', 'x')).toEqual([]);
  });
});
