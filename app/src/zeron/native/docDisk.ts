// Account-scoped on-disk persistence for chat2 session docs and the
// workspace registry (SessionStore's saved doc+cursor). Layout under
// `baseDir` (the app's document directory):
//   {baseDir}/zeron/{orgId}/{userId}/chats/{chatId}.chat2
//   {baseDir}/zeron/{orgId}/{userId}/registry.json
// Writes are atomic: temp file + move-overwrite.
//
// Pure logic + an injectable fs port — Jest exercises the layout and
// atomic-write behavior without expo-file-system. The expo-backed binding
// lives in expoDocDisk.ts.

export interface DocDiskFs {
  readText(path: string): Promise<string | undefined>;
  writeText(path: string, contents: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface PersistedChat2 {
  /** Loro snapshot, base64. */
  snapshot: string;
  cursor: number;
}

const join = (...parts: string[]): string => parts.join('/');

export const accountDir = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(baseDir, 'zeron', orgId, userId);

export const chatDocPath = (
  baseDir: string,
  orgId: string,
  userId: string,
  chatId: string,
): string =>
  join(accountDir(baseDir, orgId, userId), 'chats', `${chatId}.chat2`);

export const registryPath = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(accountDir(baseDir, orgId, userId), 'registry.json');

export const draftsPath = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(accountDir(baseDir, orgId, userId), 'drafts.json');

export class DocDisk {
  /** Per-path write queue — concurrent atomic writes to the same file would
   * otherwise race on the shared `.tmp` name. */
  private tails = new Map<string, Promise<void>>();

  constructor(
    private readonly fs: DocDiskFs,
    private readonly baseDir: string,
  ) {}

  private writeAtomic(path: string, contents: string): Promise<void> {
    const tail = this.tails.get(path) ?? Promise.resolve();
    const next = tail.then(async () => {
      const tmp = `${path}.tmp`;
      await this.fs.writeText(tmp, contents);
      await this.fs.move(tmp, path);
    });
    this.tails.set(
      path,
      next.catch(() => {}),
    );
    return next;
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    const text = await this.fs.readText(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  saveChat2(
    orgId: string,
    userId: string,
    chatId: string,
    state: PersistedChat2,
  ): Promise<void> {
    return this.writeAtomic(
      chatDocPath(this.baseDir, orgId, userId, chatId),
      JSON.stringify(state),
    );
  }

  loadChat2(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<PersistedChat2 | undefined> {
    return this.readJson<PersistedChat2>(
      chatDocPath(this.baseDir, orgId, userId, chatId),
    );
  }

  saveRegistry(
    orgId: string,
    userId: string,
    serialized: string,
  ): Promise<void> {
    return this.writeAtomic(
      registryPath(this.baseDir, orgId, userId),
      serialized,
    );
  }

  loadRegistry(orgId: string, userId: string): Promise<string | undefined> {
    return this.fs.readText(registryPath(this.baseDir, orgId, userId));
  }

  saveDrafts(
    orgId: string,
    userId: string,
    drafts: Record<string, unknown>,
  ): Promise<void> {
    return this.writeAtomic(
      draftsPath(this.baseDir, orgId, userId),
      JSON.stringify(drafts),
    );
  }

  loadDrafts(
    orgId: string,
    userId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.readJson<Record<string, unknown>>(
      draftsPath(this.baseDir, orgId, userId),
    );
  }

  async clearAccount(orgId: string, userId: string): Promise<void> {
    await this.fs.delete(accountDir(this.baseDir, orgId, userId));
  }
}
