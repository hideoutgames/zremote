import {
  blobDetail,
  blobPartId,
  CALL_WRAP_COLS,
  callBlock,
  formatKb,
  FULL_OUTPUT_MAX_LINES,
  OUTPUT_DETAIL_MAX_LINES,
  parseToolDiffJson,
  toolCopyText,
  toolDetail,
  truncateFileLines,
  wrapCols,
} from '../src/components/transcript/toolDetail';
import { fileDiffFromText } from '../src/zeron/diff/fileDiffFromText';
import type { ToolDetail } from '../src/components/transcript/toolDetail';

const linesOf = (d: ToolDetail | undefined): string[] | undefined =>
  d?.kind === 'output' ? d.lines : undefined;

test('callBlock maps each kind to an invocation', () => {
  expect(callBlock({ kind: 'exec', command: 'cargo test' })).toEqual({
    kind: 'output',
    lines: ['cargo test'],
    truncatedBy: 0,
  });
  expect(linesOf(callBlock({ kind: 'readFile', path: '/a/b.ts' }))).toEqual([
    '/a/b.ts',
  ]);
  expect(
    linesOf(
      callBlock({ kind: 'writeFile', path: '/a', content: 'hi' } as never),
    ),
  ).toEqual(['/a', 'hi']);
  expect(linesOf(callBlock({ kind: 'editFile', path: '/a' }))).toEqual(['/a']);
  expect(linesOf(callBlock({ kind: 'applyPatch' }))).toEqual(['workspace']);
  expect(
    linesOf(callBlock({ kind: 'search', pattern: 'foo', path: 'src' })),
  ).toEqual(['foo in src']);
  expect(linesOf(callBlock({ kind: 'glob', pattern: '**/*.ts' }))).toEqual([
    '**/*.ts',
  ]);
  expect(linesOf(callBlock({ kind: 'webFetch', url: 'https://x' }))).toEqual([
    'https://x',
  ]);
  expect(linesOf(callBlock({ kind: 'webSearch', query: 'q' }))).toEqual(['q']);
  expect(
    linesOf(
      callBlock({
        kind: 'todo',
        items: [
          { text: 'one', done: true },
          { text: 'two', done: false },
        ],
      }),
    ),
  ).toEqual(['[x] one', '[ ] two']);
  expect(
    linesOf(callBlock({ kind: 'mcp', server: 'git', tool: 'status' })),
  ).toEqual(['git · status']);
  expect(
    linesOf(
      callBlock({
        kind: 'unknown',
        name: 'Shell',
        input: { command: 'ls' },
      } as never),
    ),
  ).toEqual(['Shell', '{', '  "command": "ls"', '}']);
});

test('callBlock wraps long invocation lines and caps at 24', () => {
  const long = 'a'.repeat(CALL_WRAP_COLS);
  expect(wrapCols(long + 'b', CALL_WRAP_COLS)[0].length).toBe(CALL_WRAP_COLS);
  const many = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const block = callBlock({ kind: 'exec', command: many });
  expect(block?.kind).toBe('output');
  if (block?.kind !== 'output') return;
  expect(block.lines).toHaveLength(OUTPUT_DETAIL_MAX_LINES);
  expect(block.truncatedBy).toBe(6);
});

test('toolDetail prefers diff, then stats, then output', () => {
  const diff = {
    path: 'a.ts',
    oldText: 'one',
    newText: 'two',
  };
  const stats = [{ path: 'a.ts', additions: 1, deletions: 1 }];
  const asDiff = toolDetail('ignored', diff, stats);
  expect(asDiff?.kind).toBe('diff');
  const asStats = toolDetail('ignored', undefined, stats);
  expect(asStats).toEqual({ kind: 'stats', stats });
  const asOut = toolDetail('hello\nworld', undefined, undefined);
  expect(asOut).toEqual({
    kind: 'output',
    lines: ['hello', 'world'],
    truncatedBy: 0,
  });
});

test('toolDetail truncates long output and empty diffs vanish', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `L${i}`);
  const out = toolDetail(lines.join('\n'), undefined, undefined);
  expect(out?.kind).toBe('output');
  if (out?.kind !== 'output') return;
  expect(out.lines).toHaveLength(OUTPUT_DETAIL_MAX_LINES);
  expect(out.truncatedBy).toBe(6);
  expect(
    toolDetail(
      undefined,
      { path: 'a.ts', oldText: 'x', newText: 'x' },
      undefined,
    ),
  ).toBeUndefined();
});

test('blobDetail upgrades output and ToolDiff JSON', () => {
  const many = Array.from({ length: 10 }, (_, i) => `b${i}`).join('\n');
  expect(blobDetail(many, false)).toEqual({
    kind: 'output',
    lines: many.split('\n'),
    truncatedBy: 0,
  });
  const huge = Array.from(
    { length: FULL_OUTPUT_MAX_LINES + 5 },
    (_, i) => `x${i}`,
  ).join('\n');
  const fetched = blobDetail(huge, false);
  expect(fetched?.kind).toBe('output');
  if (fetched?.kind !== 'output') return;
  expect(fetched.lines).toHaveLength(FULL_OUTPUT_MAX_LINES);
  expect(fetched.truncatedBy).toBe(5);

  const json = JSON.stringify({
    path: 'src/a.ts',
    oldText: 'a',
    newText: 'b',
  });
  const diff = blobDetail(json, true);
  expect(diff?.kind).toBe('diff');
  expect(parseToolDiffJson(json)).toEqual({
    path: 'src/a.ts',
    oldText: 'a',
    newText: 'b',
  });
  expect(blobDetail('not-json', true)).toBeUndefined();
});

test('formatKb and blobPartId', () => {
  expect(formatKb(812)).toBe('812 B');
  expect(formatKb(1024)).toBe('1 KB');
  expect(formatKb(12_001)).toBe('12 KB');
  expect(blobPartId('chat/part')).toBe('part');
  expect(blobPartId('chat/part.diff')).toBe('part.diff');
  expect(blobPartId('part')).toBe('part');
});

test('truncateFileLines counts across hunks', () => {
  const file = fileDiffFromText(
    'a.ts',
    Array.from({ length: 10 }, (_, i) => `o${i}`).join('\n'),
    Array.from({ length: 10 }, (_, i) => `n${i}`).join('\n'),
  );
  const { truncatedBy, file: small } = truncateFileLines(file, 4);
  expect(truncatedBy).toBe(16);
  expect(small.hunks[0].lines).toHaveLength(4);
});

test('toolCopyText joins invocation and result', () => {
  expect(
    toolCopyText(callBlock({ kind: 'exec', command: 'ls' }), {
      kind: 'output',
      lines: ['a', 'b'],
      truncatedBy: 0,
    }),
  ).toBe('ls\n\na\nb');
  expect(
    toolCopyText(undefined, {
      kind: 'stats',
      stats: [{ path: 'a.ts', additions: 2, deletions: 1 }],
    }),
  ).toBe('a.ts  +2  −1');
});
