// File bytes for attachment uploads (expo-file-system SDK 57 File API).
// Separate module so the pure upload logic stays Jest-runnable.

import { File } from 'expo-file-system';

export const readFileBase64 = (uri: string): Promise<string> =>
  new File(uri).base64();
