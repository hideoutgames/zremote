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

test('recentMenuModels pads to 3 from the catalog when recents are empty', () => {
  const items = recentMenuModels(
    [],
    catalog,
    { harness: 'claude-code', model: 'opus' },
    3,
  );
  expect(items).toHaveLength(3);
  expect(items[0]).toEqual(catalog[1]);
  expect(items.map(i => i.model)).toEqual(['opus', 'sonnet', 'gpt-5']);
});

test('recentMenuModels prefers recents then same harness', () => {
  const items = recentMenuModels(
    [{ harness: 'codex', model: 'gpt-5' }],
    catalog,
    { harness: 'cursor', model: 'composer' },
    3,
  );
  expect(items.map(i => i.model)).toEqual(['composer', 'gpt-5', 'sonnet']);
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
