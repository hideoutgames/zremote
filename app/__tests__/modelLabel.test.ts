import {
  composerShowsEffort,
  modelsBoundToProvider,
  providerKind,
  shortModelLabel,
} from '../src/components/modelLabel';

test('shortModelLabel strips provider prefixes', () => {
  expect(shortModelLabel('Claude Code Opus 5')).toBe('Opus 5');
  expect(shortModelLabel('Claude Sonnet')).toBe('Sonnet');
  expect(shortModelLabel('OpenAI Codex GPT-5')).toBe('GPT-5');
  expect(shortModelLabel('GLM-5.3')).toBe('GLM-5.3');
  expect(shortModelLabel(undefined, 'opus-4.7')).toBe('opus-4.7');
  expect(shortModelLabel('')).toBe('');
});

test('providerKind maps harness and model ids', () => {
  expect(providerKind('claude-code', 'opus-4.7')).toBe('claude');
  expect(providerKind('codex', 'gpt-5')).toBe('openai');
  expect(providerKind('cursor', 'composer-1.5')).toBe('cursor');
  expect(providerKind('devin', 'devin-2')).toBe('devin');
  expect(providerKind('grok', 'grok-4')).toBe('grok');
  expect(providerKind('opencode', 'glm-5.3')).toBe('zhipu');
  expect(providerKind('antigravity', 'gemini-2.5')).toBe('google');
  expect(providerKind('hermes', 'hermes-3')).toBe('generic');
});

test('Devin offers effort only when the host advertises levels', () => {
  expect(composerShowsEffort(['low', 'medium', 'high'])).toBe(true);
  expect(composerShowsEffort([])).toBe(false);
});

test('modelsBoundToProvider keeps only the session provider', () => {
  const models = [
    { id: 'opus-4.7' },
    { id: 'sonnet-4' },
    { id: 'gpt-5' },
  ];
  expect(
    modelsBoundToProvider(models, 'claude-code', 'opus-4.7').map(m => m.id),
  ).toEqual(['opus-4.7', 'sonnet-4']);
  expect(
    modelsBoundToProvider(models, 'claude-code', undefined).map(m => m.id),
  ).toEqual(['opus-4.7', 'sonnet-4', 'gpt-5']);
});
