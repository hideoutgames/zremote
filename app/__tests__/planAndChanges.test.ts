import {
  applyPlanPrefix,
  stripPlanPrefix,
  withPlanPrefixIf,
} from '../src/components/planMode';
import {
  detectPlanArtifact,
  isPlanToolPart,
} from '../src/components/transcript/detectPlan';
import {
  fileKindIcon,
  turnChanges,
} from '../src/components/transcript/turnChanges';
import { fileDiffFromText } from '../src/zeron/diff/fileDiffFromText';
import type { MessageEntry } from '../src/zeron/protocol/types';

test('applyPlanPrefix is idempotent and skips empty', () => {
  expect(applyPlanPrefix('')).toBe('');
  expect(applyPlanPrefix('  ')).toBe('');
  const once = applyPlanPrefix('ship it');
  expect(
    once.startsWith('/plan PLEASE CREATE A PLAN BEFORE IMPLEMENTING:'),
  ).toBe(true);
  expect(applyPlanPrefix(once)).toBe(once);
  expect(withPlanPrefixIf(false, 'x')).toBe('x');
  expect(withPlanPrefixIf(true, 'x')).toBe(applyPlanPrefix('x'));
});

test('stripPlanPrefix recovers the user text', () => {
  expect(stripPlanPrefix('hello')).toEqual({ plan: false, text: 'hello' });
  const sent = applyPlanPrefix('fix the cert');
  expect(stripPlanPrefix(sent)).toEqual({ plan: true, text: 'fix the cert' });
});

const assistant = (
  parts: MessageEntry['parts'],
  status: MessageEntry['status'] = 'complete',
): MessageEntry => ({
  id: 'a1',
  role: 'assistant',
  parts,
  createdAt: 1,
  deviceId: 'd1',
  status,
});

test('detectPlanArtifact reads Cursor createPlan input', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'unknown',
        name: 'createPlan',
        input: {
          name: 'Signing fix',
          plan: '# Signing fix\n\nUse one cert.',
        },
      },
      resolved: true,
    },
  ]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'Signing fix',
    markdown: '# Signing fix\n\nUse one cert.',
    toolId: 't1',
  });
  expect(isPlanToolPart(entry.parts[0])).toBe(true);
});

test('detectPlanArtifact uses Claude EnterPlanMode + following text', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't0',
      call: { kind: 'unknown', name: 'EnterPlanMode' },
      resolved: true,
    },
    {
      kind: 'text',
      id: 'txt',
      text: '# Composer grabber\n\nAdd a drag handle.',
    },
  ]);
  expect(detectPlanArtifact(entry)?.name).toBe('Composer grabber');
  expect(detectPlanArtifact(entry)?.markdown).toContain('drag handle');
});

test('turnChanges is unique paths with summed stats', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 'e1',
      call: { kind: 'editFile', path: 'app/ios-testflight.yml' },
      resolved: true,
      diffStats: [
        { path: 'app/ios-testflight.yml', additions: 25, deletions: 6 },
      ],
    },
    {
      kind: 'tool',
      id: 'e2',
      call: { kind: 'writeFile', path: 'docs/TESTFLIGHT.md' },
      resolved: true,
      diffStats: [{ path: 'docs/TESTFLIGHT.md', additions: 28, deletions: 2 }],
    },
    {
      kind: 'tool',
      id: 'run',
      call: { kind: 'exec', command: 'npm test' },
      resolved: true,
    },
  ]);
  const files = turnChanges(entry);
  expect(files.map(f => f.path)).toEqual([
    'app/ios-testflight.yml',
    'docs/TESTFLIGHT.md',
  ]);
  expect(files[0].additions).toBe(25);
  expect(files[1].deletions).toBe(2);
  expect(fileKindIcon('docs/TESTFLIGHT.md')).toBe('doc.text');
  expect(fileKindIcon('app/src/foo.ts')).toBe('terminal');
});

test('fileDiffFromText marks old lines deleted and new lines added', () => {
  const file = fileDiffFromText('a.ts', 'one\ntwo', 'one\nthree');
  expect(file.status).toBe('modified');
  expect(file.hunks[0].lines.filter(l => l.kind === 'del')).toHaveLength(2);
  expect(file.hunks[0].lines.filter(l => l.kind === 'add')).toHaveLength(2);
});
