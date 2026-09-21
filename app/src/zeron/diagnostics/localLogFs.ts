// Filesystem port for local diagnostic logs. Jest supplies an in-memory
// implementation; the device binding lives in native/expoLocalLogs.ts.

export interface LocalLogDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface LocalLogFs {
  /** Create missing parents and append `chunk` to `path`. */
  appendText(path: string, chunk: string): Promise<void>;
  readText(path: string): Promise<string | undefined>;
  /** Direct children. Missing directories resolve to an empty list. */
  list(dir: string): Promise<LocalLogDirEntry[]>;
  /** Remove a directory tree. Missing paths are a no-op. */
  deleteTree(path: string): Promise<void>;
}
