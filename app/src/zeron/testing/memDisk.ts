// In-memory DocDisk for deterministic runtime/state tests. The
// implementation lives in src/zeron/native/memDocDisk.ts.

import { DocDisk } from '../native/docDisk';
import { MemoryDocFs } from '../native/memDocDisk';

export { MemoryDocFs };

export class MemoryFs extends MemoryDocFs {}

export const memDisk = (baseDir = '/docs') => {
  const fs = new MemoryFs();
  return { fs, disk: new DocDisk(fs, baseDir) };
};

/** Drain pending microtasks (fake-clock-friendly). */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
