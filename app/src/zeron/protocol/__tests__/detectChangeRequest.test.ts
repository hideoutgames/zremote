// detectChangeRequest: transcript PR/MR link detection covering every git
// provider's URL shape — the fallback for threads the host's gh-only
// checkout watch can't resolve.

import {
  clearThreadPrScanner,
  detectThreadPrs,
  sameDetectedPrs,
  scanThreadPrs,
} from '../detectChangeRequest';
import type { MessageEntry, MessagePart, RenderToolCall } from '../types';

const text = (id: string, body: string): MessagePart => ({
  kind: 'text',
  id,
  text: body,
});

const execTool = (
  id: string,
  command: string,
  output?: string,
): MessagePart => ({
  kind: 'tool',
  id,
  call: { kind: 'exec', command } as RenderToolCall,
  resolved: true,
  ...(output !== undefined ? { output } : {}),
});

const entry = (
  id: string,
  parts: MessagePart[],
  over: Partial<MessageEntry> = {},
): MessageEntry => ({
  id,
  role: 'assistant',
  parts,
  createdAt: 1,
  deviceId: 'host-1',
  ...over,
});

describe('detectThreadPrs — provider coverage', () => {
  it.each([
    ['github', 'https://github.com/acme/app/pull/47', 47, 'app'],
    ['github', 'https://ghe.internal.example.com/team/repo/pull/9', 9, 'repo'],
    [
      'gitlab',
      'https://gitlab.com/group/sub/repo/-/merge_requests/34',
      34,
      'repo',
    ],
    ['gitlab', 'https://gitlab.example.com/a/b/merge_requests/3', 3, 'b'],
    ['bitbucket', 'https://bitbucket.org/ws/repo/pull-requests/12', 12, 'repo'],
    [
      'bitbucket',
      'https://stash.example.com/projects/PRJ/repos/svc/pull-requests/77',
      77,
      'svc',
    ],
    [
      'azure-devops',
      'https://dev.azure.com/org/project/_git/repo/pullrequest/42',
      42,
      'repo',
    ],
    [
      'azure-devops',
      'https://org.visualstudio.com/project/_git/repo/pullrequest/8',
      8,
      'repo',
    ],
    [
      'azure-devops',
      'https://dev.azure.com/org/project/_git/repo/pullrequest/5?foo=1',
      5,
      'repo',
    ],
    [
      'azure-devops',
      'https://dev.azure.com/org/project/_git/repo?pullRequestId=21',
      21,
      'repo',
    ],
    ['gitea', 'https://git.example.com/owner/repo/pulls/6', 6, 'repo'],
    ['gitea', 'https://codeberg.org/owner/repo/pulls/11', 11, 'repo'],
  ])('detects %s link %s', (provider, url, number, title) => {
    const prs = detectThreadPrs([
      entry('e1', [text('t1', `Opened the request: ${url}`)]),
    ]);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ provider, number, title, url });
    expect(prs[0].state).toBe('open');
  });

  it('finds PR links in tool output (gh pr create, glab, az…)', () => {
    const prs = detectThreadPrs([
      entry('e1', [
        execTool(
          'c1',
          'gh pr create --fill',
          'https://github.com/acme/app/pull/47\n',
        ),
      ]),
    ]);
    expect(prs[0]?.url).toBe('https://github.com/acme/app/pull/47');
  });

  it('finds links inside markdown and parenthesised text', () => {
    const prs = detectThreadPrs([
      entry('e1', [
        text(
          't1',
          'Done: [PR](https://github.com/acme/app/pull/5). ' +
            'Also (https://gitlab.com/g/r/-/merge_requests/2).',
        ),
      ]),
    ]);
    expect(prs.map(p => p.url)).toEqual([
      'https://gitlab.com/g/r/-/merge_requests/2',
      'https://github.com/acme/app/pull/5',
    ]);
  });
});

describe('detectThreadPrs — thread semantics', () => {
  it('returns newest first and dedupes by url', () => {
    const prs = detectThreadPrs([
      entry('e1', [text('t1', 'https://github.com/a/b/pull/1')]),
      entry('e2', [
        text(
          't2',
          'first https://github.com/a/b/pull/2 then https://gitlab.com/g/r/-/merge_requests/9',
        ),
      ]),
      entry('e3', [
        text(
          't3',
          'again https://github.com/a/b/pull/1 and https://github.com/a/b/pull/3',
        ),
      ]),
    ]);
    expect(prs.map(p => p.url)).toEqual([
      'https://github.com/a/b/pull/3',
      'https://github.com/a/b/pull/1',
      'https://gitlab.com/g/r/-/merge_requests/9',
      'https://github.com/a/b/pull/2',
    ]);
  });

  it('ignores user and system entries', () => {
    const prs = detectThreadPrs([
      entry('u1', [text('t1', 'please review https://github.com/a/b/pull/1')], {
        role: 'user',
      }),
      entry('s1', [text('t2', 'https://github.com/a/b/pull/2')], {
        role: 'system',
      }),
    ]);
    expect(prs).toEqual([]);
  });

  it('ignores non-PR urls', () => {
    const prs = detectThreadPrs([
      entry('e1', [
        text(
          't1',
          'See https://github.com/a/b/issues/5 and https://github.com/a/b/actions/runs/1 and https://example.com/pull/abc',
        ),
      ]),
    ]);
    expect(prs).toEqual([]);
  });
});

describe('scanThreadPrs — incremental cache', () => {
  afterEach(() => clearThreadPrScanner('chat'));

  it('returns the same values as detectThreadPrs and tracks growth', () => {
    const first = [entry('e1', [text('t1', 'https://github.com/a/b/pull/1')])];
    expect(scanThreadPrs('chat', first)).toEqual(detectThreadPrs(first));
    const grown = [
      ...first,
      entry('e2', [text('t2', 'https://gitlab.com/g/r/-/merge_requests/4')]),
    ];
    expect(scanThreadPrs('chat', grown)).toEqual(detectThreadPrs(grown));
    expect(scanThreadPrs('chat', grown).map(p => p.number)).toEqual([4, 1]);
  });

  it('re-scans a streaming entry as its text grows', () => {
    const streaming = entry('e1', [text('t1', 'working…')], {
      status: 'streaming',
    });
    expect(scanThreadPrs('chat', [streaming])).toEqual([]);
    const finished = entry('e1', [
      text('t1', 'working… https://github.com/a/b/pull/7'),
    ]);
    expect(scanThreadPrs('chat', [finished]).map(p => p.number)).toEqual([7]);
  });
});

describe('sameDetectedPrs', () => {
  it('compares structurally', () => {
    const a = detectThreadPrs([
      entry('e1', [text('t1', 'https://github.com/a/b/pull/1')]),
    ]);
    const b = detectThreadPrs([
      entry('e1', [text('t1', 'https://github.com/a/b/pull/1')]),
    ]);
    expect(a[0]).not.toBe(b[0]);
    expect(sameDetectedPrs(a, b)).toBe(true);
    expect(sameDetectedPrs(a, undefined)).toBe(false);
    expect(sameDetectedPrs([], [])).toBe(true);
  });
});
