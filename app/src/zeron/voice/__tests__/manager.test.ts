import { createHash } from 'crypto';
import type { VoiceModelCatalogEntry } from '../types';
import {
  VoiceDownloadPausedError,
  VoiceModelManager,
  voiceModelStore,
} from '../manager';
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
  bytes: PAYLOAD.byteLength,
  files: [
    {
      name: 'whisper-tiny.bin',
      url: 'mem://tiny',
      bytes: PAYLOAD.byteLength,
      sha256: sha256(PAYLOAD),
    },
  ],
  license: 'MIT',
  runtime: 'whisper',
  requiredRuntimeVersion: '1',
  capabilities: { supportsCustomPrompt: false, autoLanguage: true },
  productionPinned: true,
};

const ENC = new TextEncoder();
const ENC_A = ENC.encode('encoder');
const ENC_B = ENC.encode('decoder');
const ENC_T = ENC.encode('tokens');
const DIR_MODEL: VoiceModelCatalogEntry = {
  id: 'parakeet-test',
  kind: 'transcription',
  name: 'Parakeet Test',
  description: 'test',
  revision: 'r1',
  bytes: ENC_A.byteLength + ENC_B.byteLength + ENC_T.byteLength,
  files: [
    {
      name: 'encoder.onnx',
      url: 'mem://enc',
      bytes: ENC_A.byteLength,
      sha256: sha256(ENC_A),
    },
    {
      name: 'decoder.onnx',
      url: 'mem://dec',
      bytes: ENC_B.byteLength,
      sha256: sha256(ENC_B),
    },
    {
      name: 'tokens.txt',
      url: 'mem://tok',
      bytes: ENC_T.byteLength,
      sha256: sha256(ENC_T),
    },
  ],
  license: 'CC-BY-4.0',
  runtime: 'sherpa',
  requiredRuntimeVersion: '1',
  capabilities: { supportsCustomPrompt: false, autoLanguage: false },
  productionPinned: true,
};
const DIR_FILES = new Map<string, Uint8Array>([
  ['mem://enc', ENC_A],
  ['mem://dec', ENC_B],
  ['mem://tok', ENC_T],
]);

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

const makeDir = (fs = new MemoryVoiceFs()) => {
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [DIR_MODEL],
    hasher: {
      sha256File: async path => {
        const bytes = await fs.readBytes(path);
        if (bytes === undefined) throw new Error('missing');
        return sha256(bytes);
      },
    },
    downloader: {
      download: async (url, dest, opts) => {
        if (opts.signal.aborted) throw new Error('aborted');
        const payload = DIR_FILES.get(url);
        if (payload === undefined) throw new Error('unknown url');
        const existing = opts.existingBytes;
        const rest = payload.slice(existing);
        if (existing > 0) await fs.appendBytes(dest, rest);
        else await fs.writeBytes(dest, payload);
        opts.onProgress(payload.byteLength, payload.byteLength);
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

test('multi-file model installs as a directory of named artifacts', async () => {
  const { manager, fs } = makeDir();
  await manager.waitReady();
  await manager.download('parakeet-test');
  expect(manager.row('parakeet-test').state).toBe('installed');
  expect(fs.files.has('/models/parakeet-test/encoder.onnx')).toBe(true);
  expect(fs.files.has('/models/parakeet-test/decoder.onnx')).toBe(true);
  expect(fs.files.has('/models/parakeet-test/tokens.txt')).toBe(true);
  expect(manager.installedPath('parakeet-test')).toBe('/models/parakeet-test');
});

test('interrupted multi-file download resumes only the missing files', async () => {
  const fs = new MemoryVoiceFs();
  // Simulate a crashed install: encoder placed, decoder partially fetched.
  await fs.writeBytes('/models/parakeet-test/encoder.onnx', ENC_A);
  await fs.writeBytes(
    '/tmp/parakeet-test/decoder.onnx.part',
    ENC_B.slice(0, 3),
  );
  const { manager } = makeDir(fs);
  await manager.waitReady();
  expect(manager.row('parakeet-test').error).toBe('interrupted');
  await manager.download('parakeet-test');
  expect(manager.row('parakeet-test').state).toBe('installed');
  expect(fs.files.has('/models/parakeet-test/decoder.onnx')).toBe(true);
  expect(fs.files.has('/models/parakeet-test/tokens.txt')).toBe(true);
  expect(fs.files.has('/tmp/parakeet-test/decoder.onnx.part')).toBe(false);
});

test('delete removes a multi-file model directory and temp artifacts', async () => {
  const { manager, fs } = makeDir();
  await manager.waitReady();
  await manager.download('parakeet-test');
  await fs.writeBytes('/tmp/parakeet-test/extra.part', ENC_A);
  await manager.delete('parakeet-test');
  expect(manager.row('parakeet-test').state).toBe('notDownloaded');
  expect(fs.files.has('/models/parakeet-test/encoder.onnx')).toBe(false);
  expect(fs.files.has('/tmp/parakeet-test/extra.part')).toBe(false);
  expect(manager.installedPath('parakeet-test')).toBeUndefined();
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
    hasher: { sha256File: async () => sha256(PAYLOAD) },
    downloader: {
      download: (_url, _dest, opts) => {
        // The abort can land before the downloader starts (cancel between
        // the 'downloading' patch and this call) — reject immediately
        // rather than registering a listener that never fires.
        if (opts.signal.aborted) {
          return Promise.reject(new Error('aborted'));
        }
        return new Promise((resolve, reject) => {
          hanging = () => resolve();
          opts.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
      },
    },
  });
  await manager.waitReady();
  const pending = manager.download('whisper-tiny');
  await waitFor(
    () => manager.row('whisper-tiny').state === 'downloading',
    'downloading',
  );
  manager.cancelDownload('whisper-tiny');
  // A cancelled download must reject — resolving would fire the callers'
  // `.then(onInstalled)` and select a model that isn't installed.
  await expect(pending).rejects.toThrow('aborted');
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
    hasher: { sha256File: async () => sha256(PAYLOAD) },
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

const PAYLOAD2 = ENC.encode('base-model');
const MODEL2: VoiceModelCatalogEntry = {
  ...MODEL,
  id: 'whisper-base',
  name: 'Whisper Base',
  files: [
    {
      name: 'whisper-base.bin',
      url: 'mem://base',
      bytes: PAYLOAD2.byteLength,
      sha256: sha256(PAYLOAD2),
    },
  ],
};

test('a second download call joins the in-flight job', async () => {
  const fs = new MemoryVoiceFs();
  let calls = 0;
  let release: () => void = () => {};
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: {
      sha256File: async path => sha256((await fs.readBytes(path))!),
    },
    downloader: {
      download: async (_url, dest, opts) => {
        calls += 1;
        await new Promise<void>(resolve => {
          release = resolve;
        });
        if (opts.signal.aborted) throw new Error('aborted');
        await fs.writeBytes(dest, PAYLOAD);
      },
    },
  });
  await manager.waitReady();
  const first = manager.download('whisper-tiny');
  await waitFor(() => calls === 1, 'downloader started');
  const second = manager.download('whisper-tiny');
  release();
  await expect(first).resolves.toBeUndefined();
  await expect(second).resolves.toBeUndefined();
  expect(calls).toBe(1);
});

test('downloads run one at a time and queued rows report queued', async () => {
  const fs = new MemoryVoiceFs();
  const payloads = new Map<string, Uint8Array>([
    ['mem://tiny', PAYLOAD],
    ['mem://base', PAYLOAD2],
  ]);
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL, MODEL2],
    hasher: {
      sha256File: async path => {
        const bytes = await fs.readBytes(path);
        if (bytes === undefined) throw new Error('missing');
        return sha256(bytes);
      },
    },
    downloader: {
      download: async (url, dest, opts) => {
        started.push(url);
        const payload = payloads.get(url);
        if (payload === undefined) throw new Error('unknown url');
        await new Promise<void>(resolve => gates.set(url, resolve));
        if (opts.signal.aborted) throw new Error('aborted');
        await fs.writeBytes(dest, payload);
        opts.onProgress(payload.byteLength, payload.byteLength);
      },
    },
  });
  await manager.waitReady();
  const first = manager.download('whisper-tiny');
  await waitFor(() => started.length === 1, 'first started');
  const second = manager.download('whisper-base');
  await waitFor(
    () => manager.row('whisper-base').state === 'queued',
    'second queued',
  );
  expect(started).toEqual(['mem://tiny']);
  gates.get('mem://tiny')!();
  await first;
  // The second job only starts after the first fully installs.
  await waitFor(() => started.length === 2, 'second started');
  expect(started).toEqual(['mem://tiny', 'mem://base']);
  gates.get('mem://base')!();
  await second;
  expect(manager.row('whisper-tiny').state).toBe('installed');
  expect(manager.row('whisper-base').state).toBe('installed');
});

test('cancelling a queued download resets the row without starting it', async () => {
  const fs = new MemoryVoiceFs();
  const payloads = new Map<string, Uint8Array>([
    ['mem://tiny', PAYLOAD],
    ['mem://base', PAYLOAD2],
  ]);
  const started: string[] = [];
  let release: () => void = () => {};
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL, MODEL2],
    hasher: {
      sha256File: async path => sha256((await fs.readBytes(path))!),
    },
    downloader: {
      download: async (url, dest, opts) => {
        started.push(url);
        const payload = payloads.get(url);
        if (payload === undefined) throw new Error('unknown url');
        await new Promise<void>(resolve => {
          release = resolve;
        });
        if (opts.signal.aborted) throw new Error('aborted');
        await fs.writeBytes(dest, payload);
      },
    },
  });
  await manager.waitReady();
  const first = manager.download('whisper-tiny');
  await waitFor(() => started.length === 1, 'first started');
  const second = manager.download('whisper-base');
  await waitFor(
    () => manager.row('whisper-base').state === 'queued',
    'second queued',
  );
  manager.cancelDownload('whisper-base');
  expect(manager.row('whisper-base').state).toBe('notDownloaded');
  release();
  await first;
  await expect(second).rejects.toThrow('aborted');
  expect(started).toEqual(['mem://tiny']);
});

test('a paused download reports interrupted and keeps the partial', async () => {
  const fs = new MemoryVoiceFs();
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: { sha256File: async () => sha256(PAYLOAD) },
    downloader: {
      download: async (_url, dest) => {
        await fs.writeBytes(dest, PAYLOAD);
        throw new VoiceDownloadPausedError();
      },
    },
  });
  await manager.waitReady();
  await expect(manager.download('whisper-tiny')).rejects.toThrow('paused');
  expect(manager.row('whisper-tiny')).toEqual({
    state: 'failed',
    progress: 0,
    error: 'interrupted',
  });
  expect(fs.files.has('/tmp/whisper-tiny.part')).toBe(true);
});

test('cancel during verify keeps the downloaded part for a fast retry', async () => {
  const fs = new MemoryVoiceFs();
  let downloadCalls = 0;
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
        downloadCalls += 1;
        await fs.writeBytes(dest, PAYLOAD);
        opts.onProgress(PAYLOAD.byteLength, PAYLOAD.byteLength);
      },
    },
  });
  await manager.waitReady();
  const pending = manager.download('whisper-tiny');
  await waitFor(
    () => manager.row('whisper-tiny').state === 'verifying',
    'verifying',
  );
  manager.cancelDownload('whisper-tiny');
  await expect(pending).rejects.toThrow('aborted');
  expect(manager.row('whisper-tiny').state).toBe('notDownloaded');
  expect(fs.files.has('/tmp/whisper-tiny.part')).toBe(true);
  // Retry: the committed .part goes straight to verify — no re-download.
  await manager.download('whisper-tiny');
  expect(manager.row('whisper-tiny').state).toBe('installed');
  expect(downloadCalls).toBe(1);
});

test('verify reports progress through the row', async () => {
  const fs = new MemoryVoiceFs();
  const seen: number[] = [];
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: {
      sha256File: async (_path, onProgress) => {
        onProgress?.(4, 8);
        onProgress?.(8, 8);
        return sha256(PAYLOAD);
      },
    },
    downloader: {
      download: async (_url, dest) => {
        await fs.writeBytes(dest, PAYLOAD);
      },
    },
  });
  await manager.waitReady();
  const unsub = voiceModelStore.subscribe(s => {
    const row = s.byId['whisper-tiny'];
    if (row?.state === 'verifying') seen.push(row.progress);
  });
  await manager.download('whisper-tiny');
  unsub();
  expect(manager.row('whisper-tiny').state).toBe('installed');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(p => p >= 0 && p <= 1)).toBe(true);
});

test('reconcile flags a persisted resume blob as interrupted', async () => {
  const fs = new MemoryVoiceFs();
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: { sha256File: async () => sha256(PAYLOAD) },
    downloader: {
      download: async () => {
        throw new Error('should not fetch');
      },
      hasResumable: async () => true,
    },
  });
  await manager.waitReady();
  expect(manager.row('whisper-tiny')).toEqual({
    state: 'failed',
    progress: 0,
    error: 'interrupted',
  });
});

test('delete drops persisted resume state alongside the model', async () => {
  const fs = new MemoryVoiceFs();
  const discarded: string[] = [];
  const manager = new VoiceModelManager({
    fs,
    modelsDir: '/models',
    tmpDir: '/tmp',
    catalog: [MODEL],
    hasher: {
      sha256File: async path => sha256((await fs.readBytes(path))!),
    },
    downloader: {
      download: async (_url, dest) => {
        await fs.writeBytes(dest, PAYLOAD);
      },
      discard: async dest => {
        discarded.push(dest);
      },
    },
  });
  await manager.waitReady();
  await manager.download('whisper-tiny');
  await manager.delete('whisper-tiny');
  expect(discarded).toContain('/tmp/whisper-tiny.part');
  expect(manager.row('whisper-tiny').state).toBe('notDownloaded');
});
