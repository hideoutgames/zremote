// Device-local model installation manager. Inventory and weights live
// outside account-scoped uiPrefs / CRDT state.

import { createStore } from 'zustand';
import type { VoiceModelCatalogEntry, VoiceModelInstallState } from './types';
import { VOICE_MODEL_CATALOG, catalogEntry } from './catalog';

export interface VoiceModelFs {
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, contents: string): Promise<void>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  appendBytes(path: string, data: Uint8Array): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  freeBytes(): Promise<number>;
  excludeFromBackup(path: string): Promise<void>;
}

export interface VoiceDownloader {
  download(
    url: string,
    dest: string,
    opts: {
      onProgress: (received: number, total: number) => void;
      signal: AbortSignal;
      existingBytes: number;
    },
  ): Promise<void>;
}

export interface VoiceHasher {
  sha256File(path: string): Promise<string>;
}

export interface VoiceModelInventoryEntry {
  id: string;
  revision: string;
  bytes: number;
  sha256: string;
  installedAt: number;
}

export interface VoiceModelRowState {
  state: VoiceModelInstallState;
  progress: number;
  error?: string;
  bytes?: number;
}

export interface VoiceModelManagerDeps {
  fs: VoiceModelFs;
  downloader: VoiceDownloader;
  hasher: VoiceHasher;
  catalog?: readonly VoiceModelCatalogEntry[];
  modelsDir: string;
  tmpDir: string;
  now?: () => number;
}

const join = (...parts: string[]): string =>
  parts
    .map((p, i) => (i === 0 ? p.replace(/\/$/, '') : p.replace(/^\/|\/$/g, '')))
    .filter(p => p.length > 0)
    .join('/');

const shaOk = (sha: string): boolean => /^[0-9a-f]{64}$/i.test(sha);

interface Job {
  abort: AbortController;
}

export class VoiceModelManager {
  private readonly deps: VoiceModelManagerDeps;
  private inventory = new Map<string, VoiceModelInventoryEntry>();
  private jobs = new Map<string, Job>();
  private inUse = new Set<string>();
  private ready: Promise<void>;

  constructor(deps: VoiceModelManagerDeps) {
    this.deps = deps;
    this.ready = this.reconcile();
  }

  catalog(): readonly VoiceModelCatalogEntry[] {
    return this.deps.catalog ?? VOICE_MODEL_CATALOG;
  }

  installedPath(id: string): string | undefined {
    const entry = this.inventory.get(id);
    if (entry === undefined) return undefined;
    return this.modelPath(id);
  }

  row(id: string): VoiceModelRowState {
    return (
      voiceModelStore.getState().byId[id] ?? {
        state: 'notDownloaded',
        progress: 0,
      }
    );
  }

  markInUse(id: string): void {
    this.inUse.add(id);
  }

  release(id: string): void {
    this.inUse.delete(id);
  }

  async waitReady(): Promise<void> {
    await this.ready;
  }

  async download(id: string): Promise<void> {
    await this.ready;
    const model = this.find(id);
    if (model === undefined) throw new Error('unknown model');
    if (this.jobs.has(id)) return;
    if (!model.productionPinned || !shaOk(model.sha256)) {
      this.patch(id, {
        state: 'failed',
        progress: 0,
        error: 'unpinned',
      });
      throw new Error('model artifact is not production-pinned');
    }
    const free = await this.deps.fs.freeBytes();
    if (free < model.bytes) {
      this.patch(id, {
        state: 'failed',
        progress: 0,
        error: 'storage',
      });
      throw new Error('insufficient storage');
    }
    const tmp = this.tmpPath(id);
    const abort = new AbortController();
    this.jobs.set(id, { abort });
    this.patch(id, { state: 'downloading', progress: 0, error: undefined });
    try {
      const existing = (await this.deps.fs.exists(tmp))
        ? await this.deps.fs.size(tmp)
        : 0;
      await this.deps.downloader.download(model.url, tmp, {
        onProgress: (received, total) => {
          const denom = total > 0 ? total : model.bytes;
          this.patch(id, {
            state: 'downloading',
            progress: denom > 0 ? Math.min(1, received / denom) : 0,
          });
        },
        signal: abort.signal,
        existingBytes: existing,
      });
      this.patch(id, { state: 'verifying', progress: 1 });
      const digest = await this.deps.hasher.sha256File(tmp);
      if (digest.toLowerCase() !== model.sha256.toLowerCase()) {
        await this.deps.fs.delete(tmp);
        this.patch(id, {
          state: 'failed',
          progress: 0,
          error: 'checksum',
        });
        throw new Error('checksum mismatch');
      }
      await this.deps.fs.mkdir(this.deps.modelsDir);
      await this.deps.fs.excludeFromBackup(this.deps.modelsDir);
      const dest = this.modelPath(id);
      await this.deps.fs.move(tmp, dest);
      await this.deps.fs.excludeFromBackup(dest);
      const rec: VoiceModelInventoryEntry = {
        id,
        revision: model.revision,
        bytes: model.bytes,
        sha256: model.sha256,
        installedAt: (this.deps.now ?? Date.now)(),
      };
      this.inventory.set(id, rec);
      await this.saveInventory();
      this.patch(id, { state: 'installed', progress: 1, error: undefined });
    } catch (e) {
      if (abort.signal.aborted) {
        this.patch(id, {
          state: 'notDownloaded',
          progress: 0,
          error: undefined,
        });
        return;
      }
      const cur = this.row(id);
      if (cur.state !== 'failed') {
        this.patch(id, {
          state: 'failed',
          progress: 0,
          error: 'failed',
        });
      }
      throw e;
    } finally {
      this.jobs.delete(id);
    }
  }

  cancelDownload(id: string): void {
    this.jobs.get(id)?.abort.abort();
  }

  async delete(id: string): Promise<void> {
    await this.ready;
    if (this.inUse.has(id)) {
      throw new Error('model in use');
    }
    this.cancelDownload(id);
    await this.deps.fs.delete(this.modelPath(id));
    await this.deps.fs.delete(this.tmpPath(id));
    this.inventory.delete(id);
    await this.saveInventory();
    this.patch(id, {
      state: 'notDownloaded',
      progress: 0,
      error: undefined,
    });
  }

  private find(id: string): VoiceModelCatalogEntry | undefined {
    return (this.deps.catalog ?? VOICE_MODEL_CATALOG).find(e => e.id === id);
  }

  private modelPath(id: string): string {
    return join(this.deps.modelsDir, `${id}.bin`);
  }

  private tmpPath(id: string): string {
    return join(this.deps.tmpDir, `${id}.part`);
  }

  private inventoryPath(): string {
    return join(this.deps.modelsDir, 'inventory.json');
  }

  private patch(id: string, row: VoiceModelRowState): void {
    voiceModelStore.setState(s => ({
      byId: { ...s.byId, [id]: row },
    }));
  }

  private async saveInventory(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.modelsDir);
    await this.deps.fs.excludeFromBackup(this.deps.modelsDir);
    await this.deps.fs.writeText(
      this.inventoryPath(),
      JSON.stringify([...this.inventory.values()]),
    );
  }

  private async reconcile(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.modelsDir);
    await this.deps.fs.mkdir(this.deps.tmpDir);
    await this.deps.fs.excludeFromBackup(this.deps.modelsDir);
    const raw = await this.deps.fs.readText(this.inventoryPath());
    if (raw !== undefined) {
      try {
        const parsed = JSON.parse(raw) as VoiceModelInventoryEntry[];
        if (Array.isArray(parsed)) {
          for (const rec of parsed) {
            if (typeof rec?.id !== 'string') continue;
            const fileOk = await this.deps.fs.exists(this.modelPath(rec.id));
            if (!fileOk) continue;
            this.inventory.set(rec.id, rec);
            this.patch(rec.id, { state: 'installed', progress: 1 });
          }
        }
      } catch {
        // Corrupt inventory is rebuilt from remaining files on next install.
      }
    }
    const catalog = this.catalog();
    for (const model of catalog) {
      const tmp = this.tmpPath(model.id);
      if (await this.deps.fs.exists(tmp)) {
        if (this.inventory.has(model.id)) continue;
        this.patch(model.id, {
          state: 'failed',
          progress: 0,
          error: 'interrupted',
        });
      } else if (!this.inventory.has(model.id)) {
        this.patch(model.id, { state: 'notDownloaded', progress: 0 });
      }
    }
  }
}

export const voiceModelStore = createStore<{
  byId: Record<string, VoiceModelRowState>;
}>(() => ({ byId: {} }));

let bound: VoiceModelManager | undefined;

export const bindVoiceModelManager = (manager: VoiceModelManager): void => {
  bound = manager;
};

export const unbindVoiceModelManager = (): void => {
  bound = undefined;
  voiceModelStore.setState({ byId: {} });
};

export const getVoiceModelManager = (): VoiceModelManager | undefined => bound;

export const selectedModelPath = (id: string | null): string | undefined => {
  if (id == null || bound === undefined) return undefined;
  const entry = catalogEntry(id);
  if (entry === undefined) return undefined;
  const row = bound.row(id);
  if (row.state !== 'installed') return undefined;
  return bound.installedPath(id);
};
