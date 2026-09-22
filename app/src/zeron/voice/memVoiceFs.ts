// In-memory VoiceModelFs for Jest.

import type { VoiceModelFs } from './manager';

export class MemoryVoiceFs implements VoiceModelFs {
  files = new Map<string, Uint8Array>();
  excluded: string[] = [];
  diskFree = Number.MAX_SAFE_INTEGER;

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    const prefix = `${path}/`;
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  }

  async size(path: string): Promise<number> {
    return this.files.get(path)?.byteLength ?? 0;
  }

  async readText(path: string): Promise<string | undefined> {
    const bytes = this.files.get(path);
    if (bytes === undefined) return undefined;
    return new TextDecoder().decode(bytes);
  }

  async writeText(path: string, contents: string): Promise<void> {
    this.files.set(path, new TextEncoder().encode(contents));
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async appendBytes(path: string, data: Uint8Array): Promise<void> {
    const prev = this.files.get(path) ?? new Uint8Array(0);
    const next = new Uint8Array(prev.byteLength + data.byteLength);
    next.set(prev, 0);
    next.set(data, prev.byteLength);
    this.files.set(path, next);
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(path);
  }

  async move(from: string, to: string): Promise<void> {
    const data = this.files.get(from);
    if (data === undefined) throw new Error(`missing ${from}`);
    this.files.delete(from);
    this.files.set(to, data);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
    for (const k of [...this.files.keys()]) {
      if (k.startsWith(`${path}/`)) this.files.delete(k);
    }
  }

  async mkdir(_path: string): Promise<void> {
    return;
  }

  async freeBytes(): Promise<number> {
    return this.diskFree;
  }

  async excludeFromBackup(path: string): Promise<void> {
    this.excluded.push(path);
  }
}
