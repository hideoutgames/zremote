// In-memory DocDisk — tests: the full DocDisk surface over a Map, nothing
// touches the filesystem.

import { DocDisk, type DocDiskFs } from './docDisk';

export class MemoryDocFs implements DocDiskFs {
  files = new Map<string, string>();
  /** Write-order log — used by tests. */
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

export const memDocDisk = (baseDir = '/docs'): DocDisk =>
  new DocDisk(new MemoryDocFs(), baseDir);
