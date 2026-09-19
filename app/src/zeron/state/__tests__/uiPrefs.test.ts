import {
  rememberModelSettings,
  modelSettingsFor,
  setComposerExtraHeightLive,
  uiPrefsStore,
  installNewThreadComposerBackground,
  removeNewThreadComposerBackground,
  setNewThreadBackgroundEffect,
} from '../uiPrefs';
import {
  bindBackgroundFs,
  unbindBackgroundFs,
  type BackgroundFs,
} from '../newThreadBackground';

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
  });
});

afterEach(() => {
  unbindBackgroundFs();
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
