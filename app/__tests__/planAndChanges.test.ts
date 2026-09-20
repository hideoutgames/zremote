import {
  applyBuildPrefix,
  applyPlanPrefix,
  BUILD_PREFIX,
  IMPLEMENT_PLAN_TEXT,
  stripPlanPrefix,
  withBuildPrefixIf,
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
  expect(stripPlanPrefix('hello')).toEqual({ kind: null, text: 'hello' });
  const sent = applyPlanPrefix('fix the cert');
  expect(stripPlanPrefix(sent)).toEqual({
    kind: 'plan',
    text: 'fix the cert',
  });
});

test('applyBuildPrefix is idempotent and skips empty', () => {
  expect(applyBuildPrefix('')).toBe('');
  expect(applyBuildPrefix('  ')).toBe('');
  const once = applyBuildPrefix(IMPLEMENT_PLAN_TEXT);
  expect(once.startsWith(BUILD_PREFIX)).toBe(true);
  expect(applyBuildPrefix(once)).toBe(once);
  expect(withBuildPrefixIf(false, 'x')).toBe('x');
  expect(withBuildPrefixIf(true, 'x')).toBe(applyBuildPrefix('x'));
});

test('stripPlanPrefix recovers a build implement message', () => {
  const sent = applyBuildPrefix(IMPLEMENT_PLAN_TEXT);
  expect(stripPlanPrefix(sent)).toEqual({
    kind: 'build',
    text: IMPLEMENT_PLAN_TEXT,
  });
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

test('detectPlanArtifact reads createPlan arguments.plan', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'unknown',
        name: 'CreatePlan',
        arguments: { title: 'Args plan', plan: '# From arguments' },
      },
      resolved: true,
    },
  ]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'Args plan',
    markdown: '# From arguments',
    toolId: 't1',
  });
  expect(isPlanToolPart(entry.parts[0])).toBe(true);
});

test('detectPlanArtifact reads MCP createPlan', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'mcp',
        server: 'cursor',
        tool: 'createPlan',
        input: { name: 'MCP plan', plan: 'Do the thing.' },
      },
      resolved: true,
    },
  ]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'MCP plan',
    markdown: 'Do the thing.',
    toolId: 't1',
  });
  expect(isPlanToolPart(entry.parts[0])).toBe(true);
});

test('detectPlanArtifact yields a card for name-only sanitized createPlan', () => {
  const part = {
    kind: 'tool' as const,
    id: 't1',
    call: { kind: 'unknown' as const, name: 'createPlan' },
    resolved: true,
  };
  const entry = assistant([part]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'Plan',
    markdown: '',
    toolId: 't1',
  });
  expect(isPlanToolPart(part)).toBe(true);
});

test('detectPlanArtifact uses following text when createPlan has no body', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: { kind: 'unknown', name: 'createPlan' },
      resolved: true,
    },
    {
      kind: 'text',
      id: 'txt',
      text: '# Signing fix\n\nUse one cert.',
    },
  ]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'Signing fix',
    markdown: '# Signing fix\n\nUse one cert.',
    toolId: 't1',
  });
});

test('empty input does not hide top-level plan fields', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'unknown',
        name: 'createPlan',
        input: {},
        plan: '# Top level',
        title: 'Top',
      },
      resolved: true,
    },
  ]);
  expect(detectPlanArtifact(entry)).toEqual({
    name: 'Top',
    markdown: '# Top level',
    toolId: 't1',
  });
});

test('detectPlanArtifact stringifies a nested plan object', () => {
  const entry = assistant([
    {
      kind: 'tool',
      id: 't1',
      call: {
        kind: 'unknown',
        name: 'createPlan',
        args: { name: 'Nested', plan: { steps: ['a'] } },
      },
      resolved: true,
    },
  ]);
  expect(detectPlanArtifact(entry)?.name).toBe('Nested');
  expect(detectPlanArtifact(entry)?.markdown).toContain('"steps"');
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
