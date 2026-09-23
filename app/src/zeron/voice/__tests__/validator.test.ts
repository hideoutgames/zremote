import { validateCleanupOutput } from '../validator';

test('removes leading filler', () => {
  const r = validateCleanupOutput('um open the settings', 'open the settings');
  expect(r).toEqual({ ok: true, text: 'open the settings' });
});

test('keeps the final self-correction', () => {
  const r = validateCleanupOutput(
    'change the text to change the text to red no change it to blue',
    'change the text to blue',
  );
  expect(r).toEqual({ ok: true, text: 'change the text to blue' });
});

test('preserves meaningful like, repetition, and quoted filler', () => {
  const input = 'it is like um very very important to say um out loud';
  const kept = validateCleanupOutput(input, input);
  expect(kept.ok).toBe(true);
  const trimmed = validateCleanupOutput(
    input,
    'it is like very very important to say um out loud',
  );
  expect(trimmed.ok).toBe(true);
});

test('preserves negation, numbers, paths, names, and identifiers', () => {
  const input = 'do not delete backup-2 for Andre at src/foo.ts count 42';
  expect(validateCleanupOutput(input, input)).toEqual({
    ok: true,
    text: input,
  });
});

test('empty output is allowed only for filler-only input', () => {
  expect(validateCleanupOutput('um uh erm', '')).toEqual({
    ok: true,
    text: '',
  });
  expect(validateCleanupOutput('open settings', '').ok).toBe(false);
});

test('rejects added, substituted, and reordered words', () => {
  expect(
    validateCleanupOutput('open the settings', 'open the preferences').ok,
  ).toBe(false);
  expect(
    validateCleanupOutput('open the settings', 'close the settings').ok,
  ).toBe(false);
  expect(
    validateCleanupOutput('open the settings', 'settings the open').ok,
  ).toBe(false);
});

test('accepts casing-only changes to retained words', () => {
  expect(
    validateCleanupOutput('um i open the settings', 'I open the settings').ok,
  ).toBe(true);
  expect(
    validateCleanupOutput('meet andre at noON', 'meet Andre at noon').ok,
  ).toBe(true);
});

test('rejects commentary and truncated generation', () => {
  expect(
    validateCleanupOutput('open the settings', 'Output: open the settings').ok,
  ).toBe(false);
  expect(
    validateCleanupOutput('open the settings', 'open the settings', {
      truncated: true,
    }).ok,
  ).toBe(false);
});
