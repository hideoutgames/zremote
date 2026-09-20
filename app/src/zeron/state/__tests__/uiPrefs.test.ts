import {
  rememberModelSettings,
  modelSettingsFor,
  setComposerExtraHeight,
  setComposerExtraHeightLive,
  uiPrefsStore,
  installNewThreadComposerBackground,
  removeNewThreadComposerBackground,
  setColorSchemePreference,
  setNewThreadBackgroundEffect,
  setSessionBackgroundBlur,
  bindUiPrefs,
  unbindUiPrefs,
  togglePinnedModel,
} from '../uiPrefs';
import {
  bindBackgroundFs,
  unbindBackgroundFs,
  type BackgroundFs,
} from '../newThreadBackground';
import { memDocDisk } from '../../native/memDocDisk';

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

beforeEach(() => {
  uiPrefsStore.setState({
    modelSettingsByKey: {},
    composerExtraHeight: 0,
    newThreadComposerBackground: undefined,
    newThreadBackgroundEffect: 'none',
    colorScheme: 'system',
    pinnedModels: [],
    sessionBackgroundBlur: false,
  });
});

afterEach(() => {
  unbindBackgroundFs();
  unbindUiPrefs();
});

test('rememberModelSettings merges per model and does not clobber siblings', () => {
  rememberModelSettings('claude', 'sonnet', { reasoning: 'high' });
  rememberModelSettings('claude', 'sonnet', {
    modelOptions: { fast: 'on' },
  });
  rememberModelSettings('claude', 'opus', { reasoning: 'low' });
  expect(modelSettingsFor('claude', 'sonnet')).toEqual({
    reasoning: 'high',
    modelOptions: { fast: 'on' },
  });
  expect(modelSettingsFor('claude', 'opus')).toEqual({ reasoning: 'low' });
});

test('setComposerExtraHeightLive updates extra height without requiring a remount', () => {
  setComposerExtraHeightLive(40);
  expect(uiPrefsStore.getState().composerExtraHeight).toBe(40);
  setComposerExtraHeightLive(0);
  expect(uiPrefsStore.getState().composerExtraHeight).toBe(0);
});

test('setComposerExtraHeightLive does not persist; setComposerExtraHeight does', async () => {
  const disk = memDocDisk();
  await bindUiPrefs(disk, 'org', 'user');
  setComposerExtraHeightLive(40);
  expect(uiPrefsStore.getState().composerExtraHeight).toBe(40);
  const mid = await disk.loadUiPrefs('org', 'user');
  expect(mid?.composerExtraHeight ?? 0).toBe(0);
  await setComposerExtraHeight(40);
  const saved = await disk.loadUiPrefs('org', 'user');
  expect(saved?.composerExtraHeight).toBe(40);
});

test('installNewThreadComposerBackground copies then replaces the pointer', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const first = await installNewThreadComposerBackground({
    uri: 'file:///tmp/one.png',
    name: 'one.png',
    mimeType: 'image/png',
    size: 20,
  });
  expect(first.ok).toBe(true);
  const stored = uiPrefsStore.getState().newThreadComposerBackground;
  expect(stored?.name).toBe('one.png');
  expect(stored?.uri).toContain('/new-thread-backgrounds/');
  expect(fs.files.size).toBe(1);

  const second = await installNewThreadComposerBackground({
    uri: 'file:///tmp/two.jpg',
    name: 'two.jpg',
    mimeType: 'image/jpeg',
    size: 20,
  });
  expect(second.ok).toBe(true);
  expect(uiPrefsStore.getState().newThreadComposerBackground?.name).toBe(
    'two.jpg',
  );
  expect(fs.files.size).toBe(1);

  setNewThreadBackgroundEffect('ascii');
  await removeNewThreadComposerBackground();
  expect(uiPrefsStore.getState().newThreadComposerBackground).toBeUndefined();
  expect(uiPrefsStore.getState().newThreadBackgroundEffect).toBe('none');
  expect(fs.files.size).toBe(0);
});

test('install before bindUiPrefs is flushed once persist is bound', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const disk = memDocDisk();
  const installed = await installNewThreadComposerBackground({
    uri: 'file:///tmp/early.png',
    name: 'early.png',
    mimeType: 'image/png',
    size: 20,
  });
  expect(installed.ok).toBe(true);
  expect(await disk.loadUiPrefs('org', 'user')).toBeUndefined();

  await bindUiPrefs(disk, 'org', 'user');
  const saved = await disk.loadUiPrefs('org', 'user');
  expect(
    (saved?.newThreadComposerBackground as { name?: string } | undefined)?.name,
  ).toBe('early.png');
});

test('bindUiPrefs drops a wallpaper pointer whose file is gone', async () => {
  const fs = new MemoryBackgroundFs();
  bindBackgroundFs(fs);
  const disk = memDocDisk();
  await disk.saveUiPrefs('org', 'user', {
    newThreadComposerBackground: {
      uri: '/docs/new-thread-backgrounds/gone.png',
      name: 'gone.png',
    },
    newThreadBackgroundEffect: 'dither',
  });
  await bindUiPrefs(disk, 'org', 'user');
  expect(uiPrefsStore.getState().newThreadComposerBackground).toBeUndefined();
  expect(uiPrefsStore.getState().newThreadBackgroundEffect).toBe('none');
});

test('unbindUiPrefs clears wallpaper so accounts do not leak artwork', () => {
  uiPrefsStore.setState({
    newThreadComposerBackground: {
      uri: '/docs/new-thread-backgrounds/x.png',
      name: 'x.png',
    },
    newThreadBackgroundEffect: 'ascii',
  });
  unbindUiPrefs();
  expect(uiPrefsStore.getState().newThreadComposerBackground).toBeUndefined();
  expect(uiPrefsStore.getState().newThreadBackgroundEffect).toBe('none');
});

test('sessionBackgroundBlur defaults to off and persists', async () => {
  expect(uiPrefsStore.getState().sessionBackgroundBlur).toBe(false);
  const disk = memDocDisk();
  await bindUiPrefs(disk, 'org', 'user');
  await setSessionBackgroundBlur(true);
  expect(uiPrefsStore.getState().sessionBackgroundBlur).toBe(true);
  const saved = await disk.loadUiPrefs('org', 'user');
  expect(saved?.sessionBackgroundBlur).toBe(true);
});

test('colorScheme defaults to system and persists', async () => {
  expect(uiPrefsStore.getState().colorScheme).toBe('system');
  const disk = memDocDisk();
  await bindUiPrefs(disk, 'org', 'user');
  await setColorSchemePreference('dark');
  expect(uiPrefsStore.getState().colorScheme).toBe('dark');
  const saved = await disk.loadUiPrefs('org', 'user');
  expect(saved?.colorScheme).toBe('dark');
});

test('bindUiPrefs restores a saved colorScheme', async () => {
  const disk = memDocDisk();
  await disk.saveUiPrefs('org', 'user', { colorScheme: 'light' });
  await bindUiPrefs(disk, 'org', 'user');
  expect(uiPrefsStore.getState().colorScheme).toBe('light');
});

test('bindUiPrefs ignores an invalid colorScheme', async () => {
  const disk = memDocDisk();
  await disk.saveUiPrefs('org', 'user', { colorScheme: 'neon' });
  await bindUiPrefs(disk, 'org', 'user');
  expect(uiPrefsStore.getState().colorScheme).toBe('system');
});

test('togglePinnedModel persists and unpins', async () => {
  const disk = memDocDisk();
  await bindUiPrefs(disk, 'org', 'user');
  await togglePinnedModel({ harness: 'claude-code', model: 'sonnet' });
  expect(uiPrefsStore.getState().pinnedModels).toEqual([
    { harness: 'claude-code', model: 'sonnet' },
  ]);
  const saved = await disk.loadUiPrefs('org', 'user');
  expect(saved?.pinnedModels).toEqual([
    { harness: 'claude-code', model: 'sonnet' },
  ]);
  await togglePinnedModel({ harness: 'claude-code', model: 'sonnet' });
  expect(uiPrefsStore.getState().pinnedModels).toEqual([]);
});
