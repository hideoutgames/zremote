// In-memory DocDisk for deterministic runtime/state tests.

import { DocDisk, type DocDiskFs } from '../native/docDisk';

export class MemoryFs implements DocDiskFs {
  files = new Map<string, string>();
  writes: string[] = [];
  async readText(path: string) {
    return this.files.get(path);
  }
  async writeText(path: string, contents: string) {
    this.writes.push(path);
    this.files.set(path, contents);
  }
  async move(from: string, to: string) {
    const c = this.files.get(from);
    if (c === undefined) throw new Error(`no temp file: ${from}`);
    this.files.delete(from);
    this.files.set(to, c);
  }
  async delete(path: string) {
    for (const k of [...this.files.keys()]) {
      if (k === path || k.startsWith(`${path}/`)) this.files.delete(k);
    }
  }
}

export const memDisk = (baseDir = '/docs') => {
  const fs = new MemoryFs();
  return { fs, disk: new DocDisk(fs, baseDir) };
};

/** Drain pending microtasks (fake-clock-friendly). */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
