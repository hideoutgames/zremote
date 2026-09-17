// expo-file-system (SDK 57 `File`/`Directory`/`Paths` API — the non-legacy
// surface) binding for `DocDisk`. Kept in its own module so the pure
// `docDisk.ts` logic stays Jest-runnable without expo transforms.

import { Directory, File, Paths } from 'expo-file-system';
import { DocDisk, type DocDiskFs } from './docDisk';

export const expoDocDiskFs: DocDiskFs = {
  async readText(path) {
    const f = new File(path);
    if (!f.exists) return undefined;
    return f.text();
  },
  async writeText(path, contents) {
    const f = new File(path);
    f.create({ intermediates: true, overwrite: true });
    f.write(contents);
  },
  async move(from, to) {
    const src = new File(from);
    await src.move(new File(to), { overwrite: true });
  },
  async delete(path) {
    const target = new File(path);
    if (target.exists) target.delete();
    const dir = new Directory(path);
    if (dir.exists) dir.delete();
  },
};

export const createDocDisk = (): DocDisk =>
  new DocDisk(expoDocDiskFs, Paths.document.uri);
