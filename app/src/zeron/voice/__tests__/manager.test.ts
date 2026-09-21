import { createHash } from 'crypto';
import type { VoiceModelCatalogEntry } from '../types';
import { VoiceModelManager } from '../manager';
import { MemoryVoiceFs } from '../memVoiceFs';

const waitFor = async (pred: () => boolean, label: string): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (pred()) return;
    await Promise.resolve();
  }
  throw new Error(`timeout waiting for ${label}`);
};

const sha256 = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

const PAYLOAD = new TextEncoder().encode('tiny-model');
const MODEL: VoiceModelCatalogEntry = {
  id: 'whisper-tiny',
  kind: 'transcription',
  name: 'Whisper Tiny',
  description: 'test',
  revision: 'r1',
  url: 'mem://tiny',
  bytes: PAYLOAD.byteLength,
  sha256: sha256(PAYLOAD),
  license: 'MIT',
  runtime: 'whisper',
  requiredRuntimeVersion: '1',
  capabilities: { supportsCustomPrompt: false, autoLanguage: true },
  productionPinned: true,
};

const make = (fs = new MemoryVoiceFs()) => {
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: {
      sha256File: async path => {
        const bytes = await fs.readBytes(path);
        if (bytes === undefined) throw new Error('missing');
        return sha256(bytes);
      },
    },
    downloader: {
      download: async (_url, dest, opts) => {
        if (opts.signal.aborted) throw new Error('aborted');
        const existing = opts.existingBytes;
        const rest = PAYLOAD.slice(existing);
        if (existing > 0) await fs.appendBytes(dest, rest);
        else await fs.writeBytes(dest, PAYLOAD);
        opts.onProgress(PAYLOAD.byteLength, PAYLOAD.byteLength);
      },
    },
  });
  return { manager, fs };
};

test('download verifies checksum and installs atomically', async () => {
  const { manager, fs } = make();
  await manager.waitReady();
  await manager.download('whisper-tiny');
  expect(manager.row('whisper-tiny').state).toBe('installed');
  expect(fs.files.has('/models/whisper-tiny.bin')).toBe(true);
  expect(fs.files.has('/tmp/whisper-tiny.part')).toBe(false);
  expect(fs.excluded).toContain('/models');
  expect(fs.excluded).toContain('/models/whisper-tiny.bin');
});

test('checksum mismatch is not installed', async () => {
  const fs = new MemoryVoiceFs();
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: { sha256File: async () => '0'.repeat(64) },
    downloader: {
      download: async (_url, dest) => {
        await fs.writeBytes(dest, PAYLOAD);
      },
    },
  });
  await manager.waitReady();
  await expect(manager.download('whisper-tiny')).rejects.toThrow(/checksum/);
  expect(manager.row('whisper-tiny')).toEqual({
    state: 'failed',
    progress: 0,
    error: 'checksum',
  });
  expect(fs.files.has('/models/whisper-tiny.bin')).toBe(false);
});

test('insufficient storage does not start a download', async () => {
  const fs = new MemoryVoiceFs();
  fs.diskFree = 1;
  const { manager } = make(fs);
  await manager.waitReady();
  await expect(manager.download('whisper-tiny')).rejects.toThrow(/storage/);
  expect(manager.row('whisper-tiny').error).toBe('storage');
  expect(fs.files.has('/models/whisper-tiny.bin')).toBe(false);
});

test('cancel leaves the model not downloaded', async () => {
  const fs = new MemoryVoiceFs();
  let hanging: () => void = () => {};
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: { sha256File: async () => MODEL.sha256 },
    downloader: {
      download: (_url, _dest, opts) =>
        new Promise((resolve, reject) => {
          hanging = () => resolve();
          opts.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    },
  });
  await manager.waitReady();
  const pending = manager.download('whisper-tiny');
  await waitFor(
    () => manager.row('whisper-tiny').state === 'downloading',
    'downloading',
  );
  manager.cancelDownload('whisper-tiny');
  await pending;
  expect(manager.row('whisper-tiny').state).toBe('notDownloaded');
  hanging();
});

test('delete refuses while the model is in use', async () => {
  const { manager } = make();
  await manager.waitReady();
  await manager.download('whisper-tiny');
  manager.markInUse('whisper-tiny');
  await expect(manager.delete('whisper-tiny')).rejects.toThrow(/in use/);
  manager.release('whisper-tiny');
  await manager.delete('whisper-tiny');
  expect(manager.row('whisper-tiny').state).toBe('notDownloaded');
});

test('reconcile marks interrupted temp files as failed', async () => {
  const fs = new MemoryVoiceFs();
  await fs.writeBytes('/tmp/whisper-tiny.part', PAYLOAD);
  const { manager } = make(fs);
  await manager.waitReady();
  expect(manager.row('whisper-tiny')).toEqual({
    state: 'failed',
    progress: 0,
    error: 'interrupted',
  });
});

test('unpinned catalog entries cannot be installed', async () => {
  const fs = new MemoryVoiceFs();
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [{ ...MODEL, productionPinned: false }],
    hasher: { sha256File: async () => MODEL.sha256 },
    downloader: {
      download: async () => {
        throw new Error('should not fetch');
      },
    },
  });
  await manager.waitReady();
  await expect(manager.download('whisper-tiny')).rejects.toThrow(/pinned/);
  expect(manager.row('whisper-tiny').error).toBe('unpinned');
});
