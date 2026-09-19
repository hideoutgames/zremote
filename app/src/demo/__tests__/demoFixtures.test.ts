import {
  CHAT_WORKING,
  demoChangeRequestFor,
  demoHistoryPrs,
  demoPaths,
  demoWorkspaceListing,
} from '../fixtures';

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
