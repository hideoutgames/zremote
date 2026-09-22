// Device-local model installation manager. Inventory and weights live
// outside account-scoped uiPrefs / CRDT state.

import { createStore } from 'zustand';
import type {
  VoiceModelCatalogEntry,
  VoiceModelFile,
  VoiceModelInstallState,
} from './types';
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

/** Multi-file models install as a directory of named artifacts. */
const isDirModel = (model: VoiceModelCatalogEntry): boolean =>
  model.files.length > 1;

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
    if (
      this.inventory.has(id) &&
      (await this.deps.fs.exists(this.modelPath(id)))
    )
      return;
    if (
      !model.productionPinned ||
      model.files.length === 0 ||
      model.files.some(f => !shaOk(f.sha256))
    ) {
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
    const abort = new AbortController();
    this.jobs.set(id, { abort });
    this.patch(id, { state: 'downloading', progress: 0, error: undefined });
    let doneBytes = 0;
    let lastPatch = 0;
    try {
      for (const file of model.files) {
        const dest = this.filePath(model, file);
        if (await this.deps.fs.exists(dest)) {
          doneBytes += file.bytes;
          continue;
        }
        const tmp = this.tmpFilePath(model, file);
        const existing = (await this.deps.fs.exists(tmp))
          ? await this.deps.fs.size(tmp)
          : 0;
        // A fully-downloaded .part goes straight to verify — asking for
        // `bytes=<size>-` returns 416 and would fail an otherwise valid resume.
        if (existing < file.bytes) {
          // Dir models keep parts under tmpDir/<id>/ — the downloader
          // does not create intermediate directories.
          await this.deps.fs.mkdir(this.parentDir(tmp));
          const base = doneBytes;
          await this.deps.downloader.download(file.url, tmp, {
            onProgress: (received, total) => {
              // Late bridge events can land after the row moved on to
              // 'verifying' — only patch while still in 'downloading'.
              if (this.row(id).state !== 'downloading') return;
              // Progress spans all files: `received` is this file's bytes,
              // `base` is everything already placed.
              const denom = model.bytes > 0 ? model.bytes : total;
              const now = Date.now();
              if (received < total && lastPatch !== 0 && now - lastPatch < 200)
                return;
              lastPatch = now;
              this.patch(id, {
                state: 'downloading',
                progress:
                  denom > 0 ? Math.min(1, (base + received) / denom) : 0,
              });
            },
            signal: abort.signal,
            existingBytes: existing,
          });
        }
        this.patch(id, { state: 'verifying', progress: 1 });
        const digest = await this.deps.hasher.sha256File(tmp);
        if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
          await this.deps.fs.delete(tmp);
          this.patch(id, {
            state: 'failed',
            progress: 0,
            error: 'checksum',
          });
          throw new Error('checksum mismatch');
        }
        await this.deps.fs.mkdir(this.parentDir(dest));
        await this.deps.fs.excludeFromBackup(this.parentDir(dest));
        await this.deps.fs.move(tmp, dest);
        await this.deps.fs.excludeFromBackup(dest);
        doneBytes += file.bytes;
      }
      await this.deps.fs.mkdir(this.deps.modelsDir);
      await this.deps.fs.excludeFromBackup(this.deps.modelsDir);
      const rec: VoiceModelInventoryEntry = {
        id,
        revision: model.revision,
        bytes: model.bytes,
        sha256: model.files.map(f => f.sha256).join(':'),
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
    const model = this.find(id);
    if (model !== undefined) {
      await this.deps.fs.delete(this.modelPath(id));
      for (const file of model.files) {
        await this.deps.fs.delete(this.tmpFilePath(model, file));
      }
      if (isDirModel(model)) {
        await this.deps.fs.delete(join(this.deps.tmpDir, id));
      }
    } else {
      await this.deps.fs.delete(join(this.deps.modelsDir, `${id}.bin`));
      await this.deps.fs.delete(join(this.deps.modelsDir, id));
      await this.deps.fs.delete(join(this.deps.tmpDir, `${id}.part`));
      await this.deps.fs.delete(join(this.deps.tmpDir, id));
    }
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

  /** Engine-facing install location: `${id}.bin` for single-file models,
   * `${id}/` directory for multi-file (sherpa) models. */
  private modelPath(id: string): string {
    const model = this.find(id);
    if (model !== undefined && isDirModel(model)) {
      return join(this.deps.modelsDir, id);
    }
    return join(this.deps.modelsDir, `${id}.bin`);
  }

  /** Final on-disk location of one artifact. */
  private filePath(
    model: VoiceModelCatalogEntry,
    file: VoiceModelFile,
  ): string {
    if (isDirModel(model)) {
      return join(this.deps.modelsDir, model.id, file.name);
    }
    return join(this.deps.modelsDir, `${model.id}.bin`);
  }

  private tmpFilePath(
    model: VoiceModelCatalogEntry,
    file: VoiceModelFile,
  ): string {
    if (isDirModel(model)) {
      return join(this.deps.tmpDir, model.id, `${file.name}.part`);
    }
    return join(this.deps.tmpDir, `${model.id}.part`);
  }

  private parentDir(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx > 0 ? path.slice(0, idx) : path;
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

  /** True when every artifact of the model sits at its final location. */
  private async allFilesPresent(
    model: VoiceModelCatalogEntry,
  ): Promise<boolean> {
    for (const file of model.files) {
      if (!(await this.deps.fs.exists(this.filePath(model, file)))) {
        return false;
      }
    }
    return true;
  }

  private async anyFilePresent(
    model: VoiceModelCatalogEntry,
  ): Promise<boolean> {
    for (const file of model.files) {
      if (await this.deps.fs.exists(this.filePath(model, file))) return true;
    }
    return false;
  }

  private async anyTmpPresent(model: VoiceModelCatalogEntry): Promise<boolean> {
    for (const file of model.files) {
      if (await this.deps.fs.exists(this.tmpFilePath(model, file))) {
        return true;
      }
    }
    return false;
  }

  /** sha256-verify every artifact at its final location. */
  private async verifyInstalledFiles(
    model: VoiceModelCatalogEntry,
  ): Promise<boolean> {
    for (const file of model.files) {
      try {
        const digest = await this.deps.hasher.sha256File(
          this.filePath(model, file),
        );
        if (digest.toLowerCase() !== file.sha256.toLowerCase()) return false;
      } catch {
        return false;
      }
    }
    return true;
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
            const model = this.find(rec.id);
            if (model === undefined) continue;
            const fileOk = await this.allFilesPresent(model);
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
      if (this.inventory.has(model.id)) continue;
      if (await this.anyTmpPresent(model)) {
        this.patch(model.id, {
          state: 'failed',
          progress: 0,
          error: 'interrupted',
        });
        continue;
      }
      // The process can die between `move(tmp, dest)` and `saveInventory`;
      // adopt fully-placed weights if they verify, otherwise reclaim them.
      if (await this.allFilesPresent(model)) {
        if (await this.verifyInstalledFiles(model)) {
          this.inventory.set(model.id, {
            id: model.id,
            revision: model.revision,
            bytes: model.bytes,
            sha256: model.files.map(f => f.sha256).join(':'),
            installedAt: (this.deps.now ?? Date.now)(),
          });
          await this.saveInventory();
          this.patch(model.id, { state: 'installed', progress: 1 });
          continue;
        }
        await this.deps.fs.delete(this.modelPath(model.id));
        this.patch(model.id, { state: 'notDownloaded', progress: 0 });
        continue;
      }
      // Partially-placed files mean a previous install died mid-flight —
      // the next download resumes only the missing artifacts.
      if (await this.anyFilePresent(model)) {
        this.patch(model.id, {
          state: 'failed',
          progress: 0,
          error: 'interrupted',
        });
      } else {
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
