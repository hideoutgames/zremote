import {
  composerMenuModels,
  groupMenuModelsByProvider,
  isPinnedModel,
  pinnedMenuModels,
  togglePinnedModelList,
} from '../src/zeron/state/pinnedModels';

const catalog = [
  {
    harness: 'claude-code',
    model: 'sonnet',
    label: 'Sonnet',
    harnessName: 'Claude',
  },
  {
    harness: 'claude-code',
    model: 'opus',
    label: 'Opus',
    harnessName: 'Claude',
  },
  { harness: 'codex', model: 'gpt-5', label: 'GPT-5', harnessName: 'Codex' },
  {
    harness: 'cursor',
    model: 'composer',
    label: 'Composer',
    harnessName: 'Cursor',
  },
];

test('togglePinnedModelList prepends, unpins, and has no cap', () => {
  const once = togglePinnedModelList([], { harness: 'a', model: '1' });
  expect(once).toEqual([{ harness: 'a', model: '1' }]);
  const twice = togglePinnedModelList(once, { harness: 'b', model: '2' });
  expect(twice[0]).toEqual({ harness: 'b', model: '2' });
  expect(isPinnedModel(twice, { harness: 'a', model: '1' })).toBe(true);

  const unpinned = togglePinnedModelList(twice, { harness: 'a', model: '1' });
  expect(unpinned).toEqual([{ harness: 'b', model: '2' }]);

  const filled = Array.from({ length: 10 }, (_, i) => ({
    harness: 'h',
    model: String(i),
  }));
  const eleventh = togglePinnedModelList(filled, {
    harness: 'h',
    model: 'new',
  });
  expect(eleventh).toHaveLength(11);
  expect(eleventh[0]).toEqual({ harness: 'h', model: 'new' });
  const afterUnpin = togglePinnedModelList(filled, {
    harness: 'h',
    model: '0',
  });
  expect(afterUnpin).toHaveLength(9);
  expect(isPinnedModel(afterUnpin, { harness: 'h', model: '0' })).toBe(false);
});

test('pinnedMenuModels preserves pin order and drops missing catalog entries', () => {
  const items = pinnedMenuModels(
    [
      { harness: 'gone', model: 'x' },
      { harness: 'codex', model: 'gpt-5' },
      { harness: 'claude-code', model: 'opus' },
    ],
    catalog,
    undefined,
    false,
  );
  expect(items.map(i => i.model)).toEqual(['gpt-5', 'opus']);
  expect(items[0]?.harnessName).toBe('Codex');
});

test('pinnedMenuModels lockHarness drops other providers and does not pad', () => {
  const items = pinnedMenuModels(
    [
      { harness: 'codex', model: 'gpt-5' },
      { harness: 'claude-code', model: 'sonnet' },
    ],
    catalog,
    { harness: 'cursor', model: 'composer' },
    true,
  );
  expect(items).toEqual([]);
});

test('pinnedMenuModels returns every catalog pin and does not inject current', () => {
  const extraCatalog = [
    ...catalog,
    ...Array.from({ length: 8 }, (_, i) => ({
      harness: 'claude-code',
      model: `extra-${i}`,
      label: `Extra ${i}`,
      harnessName: 'Claude',
    })),
  ];
  const pins = extraCatalog.map(m => ({
    harness: m.harness,
    model: m.model,
  }));
  const items = pinnedMenuModels(
    pins,
    extraCatalog,
    { harness: 'claude-code', model: 'not-pinned' },
    false,
  );
  expect(items).toHaveLength(extraCatalog.length);
  expect(items[0]?.model).toBe('sonnet');
  expect(items.some(i => i.model === 'not-pinned')).toBe(false);
});

test('composerMenuModels prefers pins and falls back to recents', () => {
  const pinned = composerMenuModels(
    [{ harness: 'codex', model: 'gpt-5' }],
    [{ harness: 'claude-code', model: 'sonnet' }],
    catalog,
    { harness: 'cursor', model: 'composer' },
    false,
  );
  expect(pinned.map(i => i.model)).toEqual(['gpt-5']);
  expect(pinned[0]?.harnessName).toBe('Codex');

  const recents = composerMenuModels(
    [{ harness: 'gone', model: 'x' }],
    [{ harness: 'codex', model: 'gpt-5' }],
    catalog,
    { harness: 'cursor', model: 'composer' },
    false,
  );
  expect(recents[0]?.model).toBe('composer');
  expect(recents.map(i => i.model)).toContain('gpt-5');
  expect(recents.find(i => i.model === 'gpt-5')?.harnessName).toBe('Codex');
  expect(recents.find(i => i.model === 'composer')?.harnessName).toBe('Cursor');
  expect(recents.length).toBeLessThanOrEqual(3);

  const locked = composerMenuModels(
    [{ harness: 'codex', model: 'gpt-5' }],
    [],
    catalog,
    { harness: 'cursor', model: 'composer' },
    true,
  );
  expect(locked.every(i => i.harness === 'cursor')).toBe(true);
});

test('composerMenuModels lockHarness shows same-provider pins only', () => {
  const items = composerMenuModels(
    [
      { harness: 'codex', model: 'gpt-5' },
      { harness: 'claude-code', model: 'sonnet' },
    ],
    [{ harness: 'claude-code', model: 'opus' }],
    catalog,
    { harness: 'claude-code', model: 'opus' },
    true,
  );
  expect(items.map(i => i.model)).toEqual(['sonnet']);
});

test('groupMenuModelsByProvider keeps pin order and splits by provider', () => {
  const groups = groupMenuModelsByProvider([
    { harness: 'codex', model: 'gpt-5', label: 'GPT-5', harnessName: 'Codex' },
    {
      harness: 'claude-code',
      model: 'sonnet',
      label: 'Sonnet',
      harnessName: 'Claude',
    },
    { harness: 'codex', model: 'gpt', label: 'GPT', harnessName: 'Codex' },
    {
      harness: 'claude-code',
      model: 'opus',
      label: 'Opus',
      harnessName: 'Claude',
    },
  ]);
  expect(groups.map(g => g.label)).toEqual(['Codex', 'Claude']);
  expect(groups[0]?.items.map(i => i.model)).toEqual(['gpt-5', 'gpt']);
  expect(groups[1]?.items.map(i => i.model)).toEqual(['sonnet', 'opus']);
});
