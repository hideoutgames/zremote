// Local file text for composer previews (expo-file-system SDK 57 File API).
// Separate module so UI stays Jest-runnable without reading disk.

import { File } from 'expo-file-system';

const MAX_PREVIEW_CHARS = 200_000;

export const readFileText = async (uri: string): Promise<string> => {
  const raw = await new File(uri).text();
  if (raw.length <= MAX_PREVIEW_CHARS) return raw;
  return `${raw.slice(0, MAX_PREVIEW_CHARS)}\n\n…`;
};
