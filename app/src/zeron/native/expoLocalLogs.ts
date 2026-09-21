// expo-file-system binding for local diagnostic logs. Kept out of
// `localLogs.ts` so the writer stays Jest-runnable without expo transforms.

import { Directory, File, Paths } from 'expo-file-system';
import type { LocalLogDirEntry, LocalLogFs } from '../diagnostics/localLogFs';
import { logsRootFor } from '../diagnostics/localLogs';

export const expoLocalLogFs: LocalLogFs = {
  async appendText(path, chunk) {
    const file = new File(path);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(chunk, { append: true });
  },
  async readText(path) {
    const file = new File(path);
    if (!file.exists) return undefined;
    return file.text();
  },
  async list(dir) {
    const directory = new Directory(dir);
    if (!directory.exists) return [];
    return directory.list().map(
      (entry): LocalLogDirEntry => ({
        name: entry.name,
        isDirectory: entry instanceof Directory,
      }),
    );
  },
  async deleteTree(path) {
    const directory = new Directory(path);
    if (directory.exists) directory.delete();
  },
};

export const accountLogsRoot = (orgId: string, userId: string): string =>
  logsRootFor(Paths.document.uri, orgId, userId);
