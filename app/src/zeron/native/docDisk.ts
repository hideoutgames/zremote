// Account-scoped on-disk persistence for chat2 session docs and the
// workspace registry (SessionStore's saved doc+cursor). Layout under
// `baseDir` (the app's document directory):
//   {baseDir}/zeron/{orgId}/{userId}/chats/{chatId}.chat2
//   {baseDir}/zeron/{orgId}/{userId}/registry.json
//   {baseDir}/zeron/{orgId}/{userId}/logs/{chatId}/{stamp}.txt
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

/** Offline-queued message backup (sidecar while the host is unreachable). */
export const queuedLocalPath = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(accountDir(baseDir, orgId, userId), 'queuedLocal.json');

/** Queued-attachment byte stash (UploadStash.swift): base64 file body plus an
 * index so a relaunch can re-derive escorts without a directory listing. */
export const uploadsDir = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(accountDir(baseDir, orgId, userId), 'uploads');

export const uploadPath = (
  baseDir: string,
  orgId: string,
  userId: string,
  uploadId: string,
): string => join(uploadsDir(baseDir, orgId, userId), `${uploadId}.b64`);

const uploadsIndexPath = (
  baseDir: string,
  orgId: string,
  userId: string,
): string => join(uploadsDir(baseDir, orgId, userId), 'index.json');

export interface StashedUpload {
  uploadId: string;
  name: string;
  size: number;
  chatId: string;
}

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

  saveQueuedLocal(
    orgId: string,
    userId: string,
    byChat: Record<string, unknown>,
  ): Promise<void> {
    return this.writeAtomic(
      queuedLocalPath(this.baseDir, orgId, userId),
      JSON.stringify(byChat),
    );
  }

  loadQueuedLocal(
    orgId: string,
    userId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.readJson<Record<string, unknown>>(
      queuedLocalPath(this.baseDir, orgId, userId),
    );
  }

  /** Small account-scoped UI preferences (live-action preference, etc.). */
  saveUiPrefs(
    orgId: string,
    userId: string,
    prefs: Record<string, unknown>,
  ): Promise<void> {
    return this.writeAtomic(
      join(accountDir(this.baseDir, orgId, userId), 'uiPrefs.json'),
      JSON.stringify(prefs),
    );
  }

  loadUiPrefs(
    orgId: string,
    userId: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.readJson<Record<string, unknown>>(
      join(accountDir(this.baseDir, orgId, userId), 'uiPrefs.json'),
    );
  }

  /** Stash a queued send's bytes (base64) under its `pending://` uploadId and
   * record it in the stash index. */
  async saveUpload(
    orgId: string,
    userId: string,
    uploadId: string,
    meta: Omit<StashedUpload, 'uploadId'>,
    base64: string,
  ): Promise<void> {
    await this.writeAtomic(
      uploadPath(this.baseDir, orgId, userId, uploadId),
      base64,
    );
    const index = (await this.loadUploadIndex(orgId, userId)) ?? {};
    index[uploadId] = { uploadId, ...meta };
    await this.writeAtomic(
      uploadsIndexPath(this.baseDir, orgId, userId),
      JSON.stringify(index),
    );
  }

  loadUpload(
    orgId: string,
    userId: string,
    uploadId: string,
  ): Promise<string | undefined> {
    return this.fs.readText(uploadPath(this.baseDir, orgId, userId, uploadId));
  }

  /** Drop the stashed bytes AND the index row (escort success or removal). */
  async deleteUpload(
    orgId: string,
    userId: string,
    uploadId: string,
  ): Promise<void> {
    await this.fs.delete(uploadPath(this.baseDir, orgId, userId, uploadId));
    const index = await this.loadUploadIndex(orgId, userId);
    if (index !== undefined && index[uploadId] !== undefined) {
      delete index[uploadId];
      await this.writeAtomic(
        uploadsIndexPath(this.baseDir, orgId, userId),
        JSON.stringify(index),
      );
    }
  }

  /** The stash index — which uploads still owe bytes to which chat. */
  async listUploads(orgId: string, userId: string): Promise<StashedUpload[]> {
    const index = await this.loadUploadIndex(orgId, userId);
    return index === undefined ? [] : Object.values(index);
  }

  private loadUploadIndex(
    orgId: string,
    userId: string,
  ): Promise<Record<string, StashedUpload> | undefined> {
    return this.readJson<Record<string, StashedUpload>>(
      uploadsIndexPath(this.baseDir, orgId, userId),
    );
  }

  async clearAccount(orgId: string, userId: string): Promise<void> {
    await this.fs.delete(accountDir(this.baseDir, orgId, userId));
  }
}
