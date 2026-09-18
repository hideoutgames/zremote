// history.test.ts — paging reducer for ListGitHistory/SearchGitHistory.

import { historyReducer } from '../src/zeron/history/history';
import type { HistoryState } from '../src/zeron/history/history';
import type { GitHistoryPage } from '../src/zeron/protocol/types';

const commit = (sha: string) => ({
  sha,
  parentShas: [],
  subject: `subject ${sha}`,
  authorName: 'A',
  authorEmail: 'a@x',
  authoredAt: '2026-01-01T00:00:00Z',
  refs: [],
});

const page = (shas: string[], nextCursor?: number): GitHistoryPage => ({
  commits: shas.map(commit),
  branchTips: [],
  headSha: 'head',
  nextCursor,
  totalCount: 500,
});

const init: HistoryState = {
  commits: [],
  query: '',
  loading: false,
};

describe('historyReducer', () => {
  it('replaces commits on a fresh page', () => {
    const s = historyReducer(
      { ...init, loading: true },
      { type: 'page', page: page(['a', 'b'], 2), append: false },
    );
    expect(s.commits.map(c => c.sha)).toEqual(['a', 'b']);
    expect(s.nextCursor).toBe(2);
    expect(s.loading).toBe(false);
  });

  it('appends paged results', () => {
    const s1 = historyReducer(init, {
      type: 'page',
      page: page(['a'], 1),
      append: false,
    });
    const s2 = historyReducer(s1, {
      type: 'page',
      page: page(['b', 'c'], undefined),
      append: true,
    });
    expect(s2.commits.map(c => c.sha)).toEqual(['a', 'b', 'c']);
    expect(s2.nextCursor).toBeUndefined();
  });

  it('a new query clears prior commits', () => {
    const s1 = historyReducer(init, {
      type: 'page',
      page: page(['a'], 1),
      append: false,
    });
    const s2 = historyReducer(s1, { type: 'query', query: 'fix' });
    expect(s2.commits).toEqual([]);
    expect(s2.nextCursor).toBeUndefined();
    expect(s2.query).toBe('fix');
  });

  it('error clears loading and keeps commits', () => {
    const s1 = historyReducer(
      { ...init, loading: true, commits: [commit('a')] },
      { type: 'error', message: 'boom' },
    );
    expect(s1.error).toBe('boom');
    expect(s1.loading).toBe(false);
    expect(s1.commits).toHaveLength(1);
  });
});
