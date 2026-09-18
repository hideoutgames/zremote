import {
  filesPaneReducer,
  workspaceFilesClient,
} from '../src/zeron/files/filesClient';
import type { FilesPaneState } from '../src/zeron/files/filesClient';
import type { WorkspaceDirectoryPage } from '../src/zeron/protocol/types';

const page = (names: string[]): WorkspaceDirectoryPage => ({
  directory: '',
  entries: names.map(n => ({
    path: n,
    name: n,
    kind: 'file' as const,
    ignored: false,
    readOnly: false,
  })),
  truncated: false,
});

const init: FilesPaneState = {
  directory: '',
  entries: [],
  includeIgnored: false,
  truncated: false,
};

test('page replaces entries and never lists .git', () => {
  const s = filesPaneReducer(init, {
    type: 'page',
    directory: '',
    page: page(['a.ts', '.git', 'b.ts']),
  });
  expect(s.entries.map(e => e.name)).toEqual(['a.ts', 'b.ts']);
});

test('ignored toggle flips the flag for the next list call', () => {
  const s = filesPaneReducer(init, { type: 'toggleIgnored' });
  expect(s.includeIgnored).toBe(true);
  expect(filesPaneReducer(s, { type: 'toggleIgnored' }).includeIgnored).toBe(
    false,
  );
});

test('errors surface verbatim', () => {
  const s = filesPaneReducer(init, {
    type: 'error',
    message: 'path escapes workspace jail',
  });
  expect(s.error).toBe('path escapes workspace jail');
});

test('client sends includeIgnored and cursor on the wire', async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const relay = {
    call: jest.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return page(['x']);
    }),
  };
  const client = workspaceFilesClient(relay as never);
  await client.listDirectory({ chatId: 'c1' }, 'src', {
    includeIgnored: true,
    cursor: 'n3xt',
  });
  expect(calls[0]).toEqual({
    method: 'ListWorkspaceDirectory',
    params: {
      chatId: 'c1',
      directory: 'src',
      includeIgnored: true,
      cursor: 'n3xt',
    },
  });
});

test('write sends expectedCheckoutId + expectedContentHash', async () => {
  const calls: Record<string, unknown>[] = [];
  const relay = {
    call: jest.fn(async (_m: string, p: Record<string, unknown>) => {
      calls.push(p);
      return {
        status: 'written',
        file: { path: 'f', contentHash: 'h2', size: 1 },
      };
    }),
  };
  const client = workspaceFilesClient(relay as never);
  await client.writeFile(
    { chatId: 'c1' },
    {
      expectedCheckoutId: 'co1',
      path: 'f',
      text: 'hello',
      expectedContentHash: 'h1',
    },
  );
  expect(calls[0]).toMatchObject({
    expectedCheckoutId: 'co1',
    expectedContentHash: 'h1',
    encoding: 'utf8',
    lineEnding: 'lf',
  });
});

test('readImage follows nextOffset chunks until done', async () => {
  const chunks = [
    {
      checkoutId: 'co',
      contentHash: 'h',
      mimeType: 'image/png',
      data: 'QUJD',
      nextOffset: 3,
      size: 6,
      done: false,
    },
    {
      checkoutId: 'co',
      contentHash: 'h',
      mimeType: 'image/png',
      data: 'REVG',
      nextOffset: 6,
      size: 6,
      done: true,
    },
  ];
  const offsets: unknown[] = [];
  const relay = {
    call: jest.fn(async (_m: string, p: Record<string, unknown>) => {
      offsets.push(p.offset);
      return p.offset === 0 ? chunks[0] : chunks[1];
    }),
  };
  const client = workspaceFilesClient(relay as never);
  const out = await client.readImage({ chatId: 'c' }, 'i.png', 'co');
  expect(offsets).toEqual([0, 3]);
  expect(out.data).toBe('QUJDREVG');
  expect(out.done).toBe(true);
});
