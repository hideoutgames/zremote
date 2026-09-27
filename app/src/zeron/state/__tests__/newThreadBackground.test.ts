import {
  adoptCustomBackground,
  bindBackgroundFs,
  copyBackgroundFile,
  parseNewThreadComposerBackground,
  retireManagedBackground,
  unbindBackgroundFs,
  validateBackgroundSource,
  wallpaperScreenFill,
  type BackgroundFs,
} from '../newThreadBackground';
import { DEFAULT_BACKGROUNDS } from '../defaultBackgrounds';
import { MAX_ATTACHMENT_BYTES } from '../../attachments/validate';

class MemoryBackgroundFs implements BackgroundFs {
  files = new Map<string, string>();
  joinManaged(fileName: string) {
    return `/docs/new-thread-backgrounds/${fileName}`;
  }
  isManagedUri(uri: string) {
    return uri.includes('/new-thread-backgrounds/');
  }
  async copyFile(fromUri: string, destUri: string) {
    this.files.set(destUri, fromUri);
  }
  async deleteFile(uri: string) {
    this.files.delete(uri);
  }
  async fileExists(uri: string) {
    return this.files.has(uri);
  }
}

afterEach(() => {
  unbindBackgroundFs();
});

test('validateBackgroundSource accepts raster images and rejects svg/oversize', () => {
  expect(
    validateBackgroundSource({
      name: 'sunset.png',
      mimeType: 'image/png',
      size: 12,
    }),
  ).toEqual({ ok: true, ext: 'png' });
  expect(
    validateBackgroundSource({
      name: 'shot.heic',
      mimeType: 'image/heic',
      size: 100,
    }),
  ).toEqual({ ok: true, ext: 'heic' });
  expect(
    validateBackgroundSource({
      name: 'art.svg',
      mimeType: 'image/svg+xml',
      size: 20,
    }),
  ).toEqual({ ok: false, reason: 'unsupported' });
  expect(
    validateBackgroundSource({
      name: 'huge.jpg',
      mimeType: 'image/jpeg',
      size: MAX_ATTACHMENT_BYTES + 1,
    }),
  ).toEqual({ ok: false, reason: 'tooLarge' });
});

test('copyBackgroundFile writes a managed unique file then retires the previous', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const first = await copyBackgroundFile(
    {
      uri: 'file:///tmp/a.png',
      name: 'a.png',
      mimeType: 'image/png',
      size: 10,
    },
    fs,
    'one',
  );
  expect(first.ok).toBe(true);
  if (first.ok === false) return;
  expect(first.background.uri).toContain('new-thread-background-one.png');
  expect(fs.files.get(first.background.uri)).toBe('file:///tmp/a.png');

  const second = await copyBackgroundFile(
    {
      uri: 'file:///tmp/b.jpg',
      name: 'b.jpg',
      mimeType: 'image/jpeg',
      size: 10,
    },
    fs,
    'two',
  );
  expect(second.ok).toBe(true);
  if (second.ok === false) return;
  await retireManagedBackground(fs, first.background, second.background.uri);
  expect(fs.files.has(first.background.uri)).toBe(false);
  expect(fs.files.get(second.background.uri)).toBe('file:///tmp/b.jpg');
});

test('wallpaperScreenFill is transparent only when artwork is set', () => {
  expect(wallpaperScreenFill('#000000', false)).toBe('#000000');
  expect(wallpaperScreenFill('#FFFFFF', true)).toBe('transparent');
});

test('parseNewThreadComposerBackground accepts legacy custom and presets', () => {
  expect(
    parseNewThreadComposerBackground({
      uri: 'file:///docs/x.png',
      name: 'x.png',
    }),
  ).toEqual({ kind: 'custom', uri: 'file:///docs/x.png', name: 'x.png' });
  expect(
    parseNewThreadComposerBackground({
      uri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/new-thread-backgrounds/new-thread-background-abc.png',
      name: 'sunset.png',
    }),
  ).toEqual({
    kind: 'custom',
    uri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/new-thread-backgrounds/new-thread-background-abc.png',
    name: 'sunset.png',
    fileName: 'new-thread-background-abc.png',
  });
  expect(
    parseNewThreadComposerBackground({ kind: 'preset', id: 'emma' }),
  ).toEqual({ kind: 'preset', id: 'emma' });
  expect(
    parseNewThreadComposerBackground({ kind: 'preset', id: '' }),
  ).toBeUndefined();
  expect(parseNewThreadComposerBackground({ kind: 'preset' })).toBeUndefined();
});

test('retireManagedBackground ignores presets and only deletes managed files', async () => {
  const fs = new MemoryBackgroundFs();
  fs.files.set('/docs/new-thread-backgrounds/keep.png', 'x');
  await retireManagedBackground(
    fs,
    { kind: 'preset', id: 'emma' },
    '/docs/new-thread-backgrounds/next.png',
  );
  expect(fs.files.size).toBe(1);
});

test('adoptCustomBackground keeps a custom image when the container path changes', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const fileName = 'new-thread-background-abc.png';
  const current = fs.joinManaged(fileName);
  fs.files.set(current, 'bytes');
  const adopted = await adoptCustomBackground({
    uri: `file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/new-thread-backgrounds/${fileName}`,
    name: 'sunset.png',
  });
  expect(adopted).toEqual({
    kind: 'custom',
    uri: current,
    name: 'sunset.png',
    fileName,
  });
});

test('adoptCustomBackground drops a managed pointer whose file is gone', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const adopted = await adoptCustomBackground({
    uri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/new-thread-backgrounds/new-thread-background-gone.png',
    name: 'gone.png',
  });
  expect(adopted).toBeUndefined();
});

test('bundled default backgrounds have unique ids', () => {
  const ids = DEFAULT_BACKGROUNDS.map(item => item.id);
  expect(ids).toHaveLength(10);
  expect(new Set(ids).size).toBe(10);
});
