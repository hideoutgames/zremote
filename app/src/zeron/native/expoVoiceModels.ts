// expo-file-system binding for the device-local voice model manager.
// Weights stay out of account-scoped uiPrefs and CRDT state.

import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {
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

export const expoVoiceModelFs: VoiceModelFs = {
  async exists(path) {
    return toFile(path).exists === true;
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

export const expoVoiceHasher: VoiceHasher = {
  async sha256File(path) {
    const bytes = await expoVoiceModelFs.readBytes(path);
    if (bytes === undefined) throw new Error('missing model file');
    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      bytes as BufferSource,
    );
    return [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
};

export const expoVoiceDownloader: VoiceDownloader = {
  async download(url, dest, opts) {
    if (opts.signal.aborted) throw new Error('aborted');
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (opts.existingBytes > 0) {
      await expoVoiceModelFs.appendBytes(dest, buf);
    } else {
      await expoVoiceModelFs.writeBytes(dest, buf);
    }
    opts.onProgress(
      opts.existingBytes + buf.byteLength,
      total || buf.byteLength,
    );
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
