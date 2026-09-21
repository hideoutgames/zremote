// expo-file-system binding for the new-thread composer background store.
// Kept out of the pure install pipeline so Jest can inject a memory fs.

import { Directory, File, Paths } from 'expo-file-system';
import {
  NEW_THREAD_BACKGROUND_DIR,
  type BackgroundFs,
} from '../state/newThreadBackground';

const managedDir = (): Directory =>
  new Directory(Paths.document, NEW_THREAD_BACKGROUND_DIR);

export const expoBackgroundFs: BackgroundFs = {
  joinManaged(fileName) {
    return new File(managedDir(), fileName).uri;
  },
  isManagedUri(uri) {
    return uri.includes(`/${NEW_THREAD_BACKGROUND_DIR}/`);
  },
  async copyFile(fromUri, destUri) {
    const dir = managedDir();
    if (!dir.exists) {
      dir.create({ intermediates: true, idempotent: true });
    }
    const dest = new File(destUri);
    if (dest.exists) dest.delete();
    new File(fromUri).copy(dest);
  },
  async deleteFile(uri) {
    const target = new File(uri);
    if (target.exists) target.delete();
  },
  async fileExists(uri) {
    return new File(uri).exists === true;
  },
};
