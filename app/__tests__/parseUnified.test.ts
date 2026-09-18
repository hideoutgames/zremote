import { parseUnified } from '../src/zeron/diff/parseUnified';

test('additions, deletions, context with line numbers', () => {
  const patch = [
    'diff --git a/f.ts b/f.ts',
    'index 0000000..1111111 100644',
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1,3 +1,4 @@',
    ' ctx',
    '-old',
    '+new1',
    '+new2',
    ' tail',
    '',
  ].join('\n');
  const [f] = parseUnified(patch);
  expect(f.status).toBe('modified');
  expect(f.oldPath).toBe('f.ts');
  expect(f.newPath).toBe('f.ts');
  const h = f.hunks[0];
  expect(h.oldStart).toBe(1);
  expect(h.newLines).toBe(4);
  const kinds = h.lines.map(l => l.kind);
  expect(kinds).toEqual(['context', 'del', 'add', 'add', 'context']);
  expect(h.lines[0].oldNo).toBe(1);
  expect(h.lines[1].oldNo).toBe(2);
  expect(h.lines[1].newNo).toBeUndefined();
  expect(h.lines[2].newNo).toBe(2);
  expect(h.lines[4].newNo).toBe(4);
});

test('new file', () => {
  const patch = [
    'diff --git a/n.ts b/n.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/n.ts',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
  ].join('\n');
  const [f] = parseUnified(patch);
  expect(f.status).toBe('added');
  expect(f.oldPath).toBeUndefined();
  expect(f.newPath).toBe('n.ts');
  expect(f.hunks[0].lines.map(l => l.kind)).toEqual(['add', 'add']);
});

test('deleted file', () => {
  const patch = [
    'diff --git a/d.ts b/d.ts',
    'deleted file mode 100644',
    '--- a/d.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
  ].join('\n');
  const [f] = parseUnified(patch);
  expect(f.status).toBe('deleted');
  expect(f.newPath).toBeUndefined();
  expect(f.hunks[0].lines[0].kind).toBe('del');
});

test('rename keeps old and new paths', () => {
  const patch = [
    'diff --git a/old.ts b/new.ts',
    'similarity index 90%',
    'rename from old.ts',
    'rename to new.ts',
    '--- a/old.ts',
    '+++ b/new.ts',
    '@@ -1 +1 @@',
    '-x',
    '+y',
  ].join('\n');
  const [f] = parseUnified(patch);
  expect(f.status).toBe('renamed');
  expect(f.oldPath).toBe('old.ts');
  expect(f.newPath).toBe('new.ts');
});

test('binary file has binary status and no hunks', () => {
  const patch = [
    'diff --git a/logo.png b/logo.png',
    'index 0000000..1111111 100644',
    'Binary files a/logo.png and b/logo.png differ',
  ].join('\n');
  const [f] = parseUnified(patch);
  expect(f.status).toBe('binary');
  expect(f.hunks).toHaveLength(0);
});

test('no-newline sentinel lands as a meta line', () => {
  const patch = [
    'diff --git a/f.ts b/f.ts',
    '--- a/f.ts',
    '+++ b/f.ts',
    '@@ -1 +1 @@',
    '-a',
    '\\ No newline at end of file',
    '+b',
    '\\ No newline at end of file',
  ].join('\n');
  const h = parseUnified(patch)[0].hunks[0];
  const metas = h.lines.filter(l => l.kind === 'meta');
  expect(metas).toHaveLength(2);
  expect(metas[0].oldNo).toBeUndefined();
});

test('multiple files in one patch', () => {
  const patch = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-1',
    '+2',
    'diff --git a/b.ts b/b.ts',
    '--- a/b.ts',
    '+++ b/b.ts',
    '@@ -5 +5 @@ section header',
    '-x',
    '+y',
  ].join('\n');
  const files = parseUnified(patch);
  expect(files).toHaveLength(2);
  expect(files[1].hunks[0].header).toBe('section header');
});
