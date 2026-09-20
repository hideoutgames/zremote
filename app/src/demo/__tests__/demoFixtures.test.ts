import {
  applyFastChoice,
  resolveModelTraits,
} from '../../components/modelTraits';
import {
  CHAT_WORKING,
  demoChangeRequestFor,
  demoHarnesses,
  demoHistoryPrs,
  demoModels,
  demoPaths,
  demoWorkspaceListing,
} from '../fixtures';

test('demo harness catalog covers every known provider encoding', () => {
  const ids = demoHarnesses().map(h => h.id);
  expect(ids).toEqual([
    'claude-code',
    'codex',
    'cursor',
    'devin',
    'grok',
    'hermes',
    'pi',
    'opencode',
    'antigravity',
    'mock',
  ]);
  expect(
    demoModels('codex')
      .find(m => m.id === 'gpt-5')
      ?.options.some(
        o => o.id === 'serviceTier' && o.choices.some(c => c.id === 'fast'),
      ),
  ).toBe(true);
  expect(
    demoModels('codex').find(m => m.id === 'gpt-daybreak-blue-latest')?.options,
  ).toEqual([]);
  expect(
    demoModels('claude-code')
      .find(m => m.id === 'opus')
      ?.options.some(o => o.id === 'fastMode'),
  ).toBe(true);
  expect(demoModels('claude')).toEqual(demoModels('claude-code'));
  expect(demoModels('cursor')[0]?.options.map(o => o.id)).toEqual([
    'effort',
    'fast',
  ]);
  expect(demoModels('devin').map(m => m.id)).toEqual([
    'gpt-6-astra-medium',
    'gpt-6-astra-high',
    'gpt-6-astra-high-fast',
  ]);
  expect(demoModels('hermes')[0]?.reasoningLevels).toEqual([]);
});

test('demo Codex Fast writes serviceTier onto modelOptions', () => {
  const catalog = demoModels('codex');
  const gpt = catalog.find(m => m.id === 'gpt-5');
  const traits = resolveModelTraits(
    gpt,
    catalog,
    demoHarnesses().find(h => h.id === 'codex')?.reasoningLevels,
  );
  expect(traits.fast?.option?.id).toBe('serviceTier');
  expect(traits.fast?.enabled).toBe(false);
  expect(
    applyFastChoice(traits, 'on', { model: 'gpt-5', modelOptions: {} }, catalog)
      .modelOptions,
  ).toEqual({ serviceTier: 'fast' });
});

test('demo workspace listing includes ignored rows and never lists .git', () => {
  const root = demoWorkspaceListing('');
  expect(root.some(e => e.name === 'node_modules' && e.ignored)).toBe(true);
  expect(root.some(e => e.name === '.git')).toBe(false);
  expect(
    demoWorkspaceListing('src/ui').some(e => e.name === 'composer.ts'),
  ).toBe(true);
});

test('demo history PRs cover working thread plus other chats', () => {
  expect(demoHistoryPrs(CHAT_WORKING).map(p => p.number)).toEqual([42, 41, 39]);
  expect(demoHistoryPrs('c-offline').length).toBeGreaterThan(0);
  expect(demoHistoryPrs('unknown-chat').length).toBeGreaterThan(0);
  expect(demoChangeRequestFor('demo/replay', demoPaths.zremote)?.number).toBe(
    42,
  );
  expect(demoChangeRequestFor('main', demoPaths.zeron)?.state).toBe('open');
  expect(demoChangeRequestFor('main', demoPaths.zremote)?.state).toBe('merged');
});
