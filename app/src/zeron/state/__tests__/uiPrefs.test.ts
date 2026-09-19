import {
  rememberModelSettings,
  modelSettingsFor,
  setComposerExtraHeightLive,
  uiPrefsStore,
} from '../uiPrefs';

beforeEach(() => {
  uiPrefsStore.setState({ modelSettingsByKey: {}, composerExtraHeight: 0 });
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
