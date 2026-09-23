// expo-file-system binding for the device-local voice model manager.
// Weights stay out of account-scoped uiPrefs and CRDT state.

import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as LegacyFS from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';
import {
  VoiceDownloadPausedError,
  VoiceModelManager,
  bindVoiceModelManager,
  type VoiceDownloader,
  type VoiceHasher,
  type VoiceModelFs,
} from '../voice/manager';

const modelsDir = (): Directory =>
  new Directory(Paths.document, 'zeron', 'models');

const tmpDir = (): Directory =>
  new Directory(Paths.cache, 'zeron', 'models-tmp');

const toFile = (path: string): File => new File(path);

const dirExists = (path: string): boolean => new Directory(path).exists;

export const expoVoiceModelFs: VoiceModelFs = {
  async exists(path) {
    return toFile(path).exists === true || dirExists(path);
  },
  async size(path) {
    const f = toFile(path);
    if (!f.exists) return 0;
    const info = f as File & { size?: number };
    return typeof info.size === 'number' ? info.size : 0;
  },
  async readText(path) {
    const f = toFile(path);
    if (!f.exists) return undefined;
    return f.text();
  },
  async writeText(path, contents) {
    const f = toFile(path);
    f.create({ intermediates: true, overwrite: true });
    f.write(contents);
  },
  async writeBytes(path, data) {
    const f = toFile(path) as File & {
      write: (value: string | Uint8Array) => void;
    };
    f.create({ intermediates: true, overwrite: true });
    f.write(data);
  },
  async appendBytes(path, data) {
    const prev = (await this.readBytes(path)) ?? new Uint8Array(0);
    const next = new Uint8Array(prev.byteLength + data.byteLength);
    next.set(prev, 0);
    next.set(data, prev.byteLength);
    await this.writeBytes(path, next);
  },
  async readBytes(path) {
    const f = toFile(path) as File & {
      bytes?: () => Promise<Uint8Array>;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
    if (!f.exists) return undefined;
    if (typeof f.bytes === 'function') return f.bytes();
    if (typeof f.arrayBuffer === 'function') {
      return new Uint8Array(await f.arrayBuffer());
    }
    return undefined;
  },
  async move(from, to) {
    await toFile(from).move(toFile(to), { overwrite: true });
  },
  async delete(path) {
    const file = toFile(path);
    if (file.exists) file.delete();
    const dir = new Directory(path);
    if (dir.exists) dir.delete();
  },
  async mkdir(path) {
    const dir = new Directory(path);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  },
  async freeBytes() {
    const space = (Paths as unknown as { availableDiskSpace?: number })
      .availableDiskSpace;
    return typeof space === 'number' ? space : Number.MAX_SAFE_INTEGER;
  },
  async excludeFromBackup(_path: string) {
    // NSURLIsExcludedFromBackupKey needs a Mac-verified native helper.
    // Cache tmp files are already outside backups; installed weights live
    // under Documents until that helper lands.
  },
};

// Chunk size for streamed hashing. Small enough that each js-sha256 update
// only stalls the JS thread for a moment; the await between chunks lets the
// run loop service UI work so the app stays responsive during verify.
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

const yieldToRunLoop = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

export const expoVoiceHasher: VoiceHasher = {
  async sha256File(path, onProgress, signal) {
    // Streamed SHA-256 — model files are hundreds of MB, so the file is
    // never materialized as a single ArrayBuffer. File.stream() pulls in
    // 1KB chunks (hundreds of thousands of bridge calls per model), so a
    // FileHandle reads 4MB at a time instead.
    const file = toFile(path);
    if (!file.exists) throw new Error('missing model file');
    const total = typeof file.size === 'number' ? file.size : 0;
    const handle = file.open(FileMode.ReadOnly);
    const hash = sha256.create();
    let done = 0;
    try {
      for (;;) {
        // A Cancel during verify must break out — otherwise the hash
        // finishes anyway and the model installs despite the cancel.
        if (signal?.aborted === true) throw new Error('aborted');
        const chunk = handle.readBytes(HASH_CHUNK_BYTES);
        if (chunk.byteLength === 0) break;
        hash.update(chunk);
        done += chunk.byteLength;
        onProgress?.(done, total);
        await yieldToRunLoop();
      }
    } finally {
      handle.close();
    }
    return hash.hex();
  },
};

const resumeStatePath = (dest: string): string => `${dest}.resume`;

export const expoVoiceDownloader: VoiceDownloader = {
  async download(url, dest, opts) {
    if (opts.signal.aborted) throw new Error('aborted');
    // DownloadResumable streams to disk and can resume via persisted
    // resumeData — no whole-file ArrayBuffer or Range-append needed.
    // The blob is consulted unconditionally: URLSession buffers partial
    // bodies in its own sandbox, so `dest` holds no committed bytes until
    // completion and `opts.existingBytes` is 0 for every paused attempt.
    let resumeData: string | undefined;
    const saved = await expoVoiceModelFs.readText(resumeStatePath(dest));
    if (saved !== undefined) {
      try {
        resumeData = (JSON.parse(saved) as { resumeData?: string }).resumeData;
      } catch {
        resumeData = undefined;
      }
    }
    if (resumeData === undefined) {
      // Partial committed bytes without session state can't be resumed
      // natively — start clean rather than trust an unknown offset.
      await expoVoiceModelFs.delete(dest);
    }

    const onProgress = (p: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => opts.onProgress(p.totalBytesWritten, p.totalBytesExpectedToWrite);

    // 'done' when the bytes are committed to `dest`; 'paused' when the
    // task was cancelled (user abort or system suspend) mid-flight. Pause
    // — not cancel — on abort so the session yields resumable bytes.
    const run = async (
      data: string | undefined,
    ): Promise<'done' | 'paused'> => {
      const task = LegacyFS.createDownloadResumable(
        url,
        dest,
        {},
        onProgress,
        data,
      );
      let pauseWrite: Promise<unknown> | undefined;
      const onAbort = () => {
        pauseWrite = task
          .pauseAsync()
          .then(async state => {
            if (state?.resumeData !== undefined) {
              await expoVoiceModelFs.writeText(
                resumeStatePath(dest),
                JSON.stringify(state),
              );
            }
          })
          .catch(() => {});
      };
      opts.signal.addEventListener('abort', onAbort);
      try {
        const result =
          data === undefined
            ? await task.downloadAsync()
            : await task.resumeAsync();
        if (result === undefined) {
          // Cancelled tasks resolve with undefined — wait for the pause to
          // land so `.resume` is on disk before the caller moves on.
          await pauseWrite;
          return 'paused';
        }
        if (typeof result.status === 'number' && result.status >= 400) {
          // HTTP failures resolve (not reject) with the error body as the
          // "download" — never let that reach the checksum stage.
          await expoVoiceModelFs.delete(dest).catch(() => {});
          throw new Error(`http ${result.status}`);
        }
        return 'done';
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
      }
    };

    try {
      if ((await run(resumeData)) === 'paused') {
        throw new VoiceDownloadPausedError();
      }
    } catch (e) {
      // A stale/corrupt resume state must not wedge Retry forever: discard
      // the partial artifacts and fetch the file from the start.
      if (
        opts.signal.aborted ||
        resumeData === undefined ||
        e instanceof VoiceDownloadPausedError
      ) {
        throw e;
      }
      await expoVoiceModelFs.delete(dest);
      await expoVoiceModelFs.delete(resumeStatePath(dest));
      if ((await run(undefined)) === 'paused') {
        throw new VoiceDownloadPausedError();
      }
    }
    await expoVoiceModelFs.delete(resumeStatePath(dest));
  },

  async hasResumable(dest) {
    return (
      (await expoVoiceModelFs.readText(resumeStatePath(dest))) !== undefined
    );
  },

  async discard(dest) {
    await expoVoiceModelFs.delete(resumeStatePath(dest));
  },
};

export const createExpoVoiceModelManager = (): VoiceModelManager =>
  new VoiceModelManager({
    fs: expoVoiceModelFs,
    downloader: expoVoiceDownloader,
    hasher: expoVoiceHasher,
    modelsDir: modelsDir().uri,
    tmpDir: tmpDir().uri,
  });

export const bindExpoVoiceModelManager = (): VoiceModelManager => {
  const manager = createExpoVoiceModelManager();
  bindVoiceModelManager(manager);
  return manager;
};
