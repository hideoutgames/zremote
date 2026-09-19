import {
  recentMenuModels,
  rememberRecentModel,
} from '../src/zeron/state/recentModels';

const catalog = [
  { harness: 'claude-code', model: 'sonnet', label: 'Sonnet' },
  { harness: 'claude-code', model: 'opus', label: 'Opus' },
  { harness: 'codex', model: 'gpt-5', label: 'GPT-5' },
  { harness: 'cursor', model: 'composer', label: 'Composer' },
];

test('rememberRecentModel prepends and dedupes', () => {
  const once = rememberRecentModel([], { harness: 'a', model: '1' });
  expect(once).toEqual([{ harness: 'a', model: '1' }]);
  const twice = rememberRecentModel(once, { harness: 'b', model: '2' });
  expect(twice[0]).toEqual({ harness: 'b', model: '2' });
  const again = rememberRecentModel(twice, { harness: 'a', model: '1' });
  expect(again[0]).toEqual({ harness: 'a', model: '1' });
  expect(again).toHaveLength(2);
});

test('recentMenuModels pads to 3 from the same harness when recents are empty', () => {
  const items = recentMenuModels(
    [],
    catalog,
    { harness: 'claude-code', model: 'opus' },
    3,
  );
  expect(items).toHaveLength(2);
  expect(items[0]).toEqual(catalog[1]);
  expect(items.map(i => i.model)).toEqual(['opus', 'sonnet']);
  expect(items.every(i => i.harness === 'claude-code')).toBe(true);
});

test('recentMenuModels drops recents from other harnesses', () => {
  const items = recentMenuModels(
    [{ harness: 'codex', model: 'gpt-5' }],
    catalog,
    { harness: 'cursor', model: 'composer' },
    3,
  );
  expect(items.map(i => i.model)).toEqual(['composer']);
  expect(items.every(i => i.harness === 'cursor')).toBe(true);
});

test('recentMenuModels lockHarness false includes other providers', () => {
  const items = recentMenuModels(
    [{ harness: 'codex', model: 'gpt-5' }],
    catalog,
    { harness: 'cursor', model: 'composer' },
    3,
    false,
  );
  expect(items.map(i => i.harness)).toEqual(
    expect.arrayContaining(['cursor', 'codex']),
  );
  expect(items[0]).toEqual(catalog[3]);
});

test('recentMenuModels ignores recents missing from the catalog', () => {
  const items = recentMenuModels(
    [{ harness: 'gone', model: 'x' }],
    catalog,
    undefined,
    3,
  );
  expect(items).toHaveLength(3);
  expect(items.every(i => i.harness !== 'gone')).toBe(true);
});
