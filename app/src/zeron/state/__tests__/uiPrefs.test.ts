import {
  rememberModelSettings,
  modelSettingsFor,
  uiPrefsStore,
} from '../uiPrefs';

beforeEach(() => {
  uiPrefsStore.setState({ modelSettingsByKey: {} });
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
