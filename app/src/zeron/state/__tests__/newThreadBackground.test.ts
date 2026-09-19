import {
  bindBackgroundFs,
  copyBackgroundFile,
  newThreadBackgroundHeight,
  retireManagedBackground,
  unbindBackgroundFs,
  validateBackgroundSource,
  type BackgroundFs,
} from '../newThreadBackground';
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

test('newThreadBackgroundHeight matches desktop 0.72 cap at 760', () => {
  expect(newThreadBackgroundHeight(400)).toBe(288);
  expect(newThreadBackgroundHeight(1000)).toBe(720);
  expect(newThreadBackgroundHeight(1200)).toBe(760);
});
