import { DEFAULT_CLEANUP_PROMPT } from '../prompt';
import {
  chooseCleanupText,
  cleanupResultTruncated,
  normalizeCleanupText,
} from '../cleanupOutput';

test('default cleanup prompt does not include a copyable example', () => {
  expect(DEFAULT_CLEANUP_PROMPT).not.toContain('→');
  expect(DEFAULT_CLEANUP_PROMPT.toLowerCase()).not.toContain(
    'open the settings',
  );
  expect(DEFAULT_CLEANUP_PROMPT.length).toBeGreaterThan(40);
});

test('normalizeCleanupText strips think tags, labels, quotes, and example arrows', () => {
  expect(
    normalizeCleanupText('<think>drop um</think>\nOutput: "open the settings"'),
  ).toBe('open the settings');
  expect(normalizeCleanupText('um open the settings → open the settings')).toBe(
    'open the settings',
  );
  expect(normalizeCleanupText('```\nopen the settings\n```')).toBe(
    'open the settings',
  );
  expect(normalizeCleanupText('open the settings')).toBe('open the settings');
  expect(normalizeCleanupText('sure open the settings')).toBe(
    'sure open the settings',
  );
  expect(
    normalizeCleanupText("Here's the cleaned transcript: open the settings"),
  ).toBe('open the settings');
});

test('chooseCleanupText prefers the candidate that is a real edit', () => {
  const transcript = 'um open the settings';
  expect(
    chooseCleanupText(transcript, {
      content: '',
      text: '<think>reasoning</think> open the settings',
    }),
  ).toBe('open the settings');
  expect(
    chooseCleanupText(transcript, {
      content: 'please open preferences',
      text: 'open the settings',
    }),
  ).toBe('open the settings');
});

test('a clean stop is not treated as a truncated cleanup', () => {
  expect(
    cleanupResultTruncated({
      truncated: true,
      stopped_eos: true,
      stopped_limit: 0,
    }),
  ).toBe(false);
  expect(
    cleanupResultTruncated({
      truncated: true,
      stopped_word: '<|im_end|>',
      stopped_limit: 0,
    }),
  ).toBe(false);
  expect(
    cleanupResultTruncated({
      truncated: false,
      stopped_limit: 1,
      stopped_eos: true,
    }),
  ).toBe(true);
  expect(
    cleanupResultTruncated({
      truncated: true,
      context_full: true,
      stopped_eos: true,
    }),
  ).toBe(true);
  expect(cleanupResultTruncated({ truncated: true })).toBe(true);
});
