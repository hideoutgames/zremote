// In-memory LocalLogFs for writer and screen tests.

import type { LocalLogDirEntry, LocalLogFs } from '../diagnostics/localLogFs';

export interface MemoryLocalLogFs extends LocalLogFs {
  files: Map<string, string>;
  calls: number;
}

export const memLocalLogFs = (): MemoryLocalLogFs => {
  const files = new Map<string, string>();
  const fs: MemoryLocalLogFs = {
    files,
    calls: 0,
    async appendText(path, chunk) {
      fs.calls += 1;
      files.set(path, (files.get(path) ?? '') + chunk);
    },
    async readText(path) {
      fs.calls += 1;
      return files.get(path);
    },
    async list(dir) {
      fs.calls += 1;
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const dirs = new Set<string>();
      const out: LocalLogDirEntry[] = [];
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash === -1) out.push({ name: rest, isDirectory: false });
        else dirs.add(rest.slice(0, slash));
      }
      for (const name of dirs) out.push({ name, isDirectory: true });
      return out;
    },
    async deleteTree(path) {
      fs.calls += 1;
      const prefix = path.endsWith('/') ? path : `${path}/`;
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(prefix)) files.delete(key);
      }
    },
  };
  return fs;
};
