import {
  replaceVoiceRange,
  restoreVoiceRange,
  spliceVoiceText,
} from '../draftInsert';

test('splice inserts at the caret without rewriting the prefix', () => {
  const r = spliceVoiceText('hello ', 6, 'world');
  expect(r.text).toBe('hello world');
  expect(r.range).toEqual({ start: 6, end: 11, raw: 'world' });
});

test('cleanup replace only touches the insertion range', () => {
  const draft = 'please open the settings now';
  const next = replaceVoiceRange(
    draft,
    { start: 7, end: 24, raw: 'open the settings' },
    'open settings',
  );
  expect(next).toBe('please open settings now');
});

test('cleanup replace is skipped when the user edited the range', () => {
  const draft = 'please OPEN the settings now';
  const next = replaceVoiceRange(
    draft,
    { start: 7, end: 24, raw: 'open the settings' },
    'open settings',
  );
  expect(next).toBeUndefined();
});

test('restore original swaps cleaned text back to raw', () => {
  const restored = restoreVoiceRange(
    'please open settings now',
    7,
    20,
    'open settings',
    'open the settings',
  );
  expect(restored).toBe('please open the settings now');
});
