import {
  toolChipContent,
  toolIcon,
  toolGroupSummary,
} from '../src/components/transcript/toolLabel';

test('exec → Run + command', () => {
  expect(toolChipContent({ kind: 'exec', command: 'cargo test' })).toEqual({
    label: 'Run',
    detail: 'cargo test',
  });
  expect(toolIcon({ kind: 'exec', command: '' })).toBe('terminal');
});

test('file ops map to their desktop labels', () => {
  expect(toolChipContent({ kind: 'readFile', path: '/a/b.ts' }).label).toBe(
    'Read',
  );
  expect(toolChipContent({ kind: 'writeFile', path: '/a' }).label).toBe(
    'Write',
  );
  expect(toolChipContent({ kind: 'editFile', path: '/a' }).label).toBe('Edit');
  expect(toolChipContent({ kind: 'applyPatch', path: '/p' }).label).toBe(
    'Patch',
  );
  expect(toolIcon({ kind: 'editFile', path: '' })).toBe('pencil');
  expect(toolIcon({ kind: 'readFile', path: '' })).toBe('doc');
});

test('search/glob/web kinds', () => {
  expect(toolChipContent({ kind: 'search', pattern: 'foo' }).label).toBe(
    'Search',
  );
  expect(toolIcon({ kind: 'glob', pattern: '' })).toBe('magnifyingglass');
  expect(toolIcon({ kind: 'webFetch', url: '' })).toBe('globe');
  expect(toolChipContent({ kind: 'webSearch', query: 'q' }).label).toBe('Web');
});

test('todo/mcp/unknown + Agent naming', () => {
  expect(
    toolChipContent({
      kind: 'todo',
      items: [{ text: 'x', done: true }],
    }),
  ).toEqual({ label: 'Todo', detail: '1/1 done' });
  expect(toolIcon({ kind: 'todo', items: [] })).toBe('checklist');
  expect(toolIcon({ kind: 'mcp', tool: 't' })).toBe('puzzlepiece.extension');
  expect(toolIcon({ kind: 'unknown', name: 'x' })).toBe('wrench');
  expect(toolIcon({ kind: 'whatever' } as never)).toBe('wrench');
  expect(
    toolChipContent({ kind: 'unknown', name: 'Agent: explore the repo' }),
  ).toEqual({ label: 'Agent', detail: 'explore the repo' });
});

test('details are single-lined', () => {
  expect(toolChipContent({ kind: 'exec', command: 'a\nb\nc' }).detail).toBe(
    'a b c',
  );
});

test('group summary counts tools like the desktop', () => {
  const tools = [
    { call: { kind: 'exec', command: 'x' } },
    { call: { kind: 'exec', command: 'y' } },
    { call: { kind: 'exec', command: 'z' } },
    { call: { kind: 'editFile', path: '/a' } },
    { call: { kind: 'editFile', path: '/b' } },
    { call: { kind: 'readFile', path: '/c' }, isError: true },
  ];
  expect(toolGroupSummary(tools)).toBe(
    'Ran 3 commands · edited 2 files · read 1 file · 1 failed',
  );
});
