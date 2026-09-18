// Git history client + reducer — ListGitHistory {cwd, cursor, limit} →
// GitHistoryPage (rpc.rs L1942-1961), SearchGitHistory {cwd, query, cursor,
// limit} (L1963-1983), ResolveGitAvatars {cwd, authors:[{sha,email}],
// cursor, limit} → {[email]: base64} (L1985-2025), FetchAll {repoPath}
// (L2027-2037; also forces a diff-sync snapshot). All relay-forwardable
// (rpc.rs L970-973, 2396-2398).

import { METHODS } from '../protocol/rpc';
import type { RelayLike } from '../attachments/upload';
import type { GitHistoryPage } from '../protocol/types';

export interface HistoryState {
  commits: GitHistoryPage['commits'];
  nextCursor?: number;
  headSha?: string;
  query: string;
  loading: boolean;
  error?: string;
}

export const historyReducer = (
  prev: HistoryState,
  event:
    | { type: 'page'; page: GitHistoryPage; append: boolean }
    | { type: 'query'; query: string }
    | { type: 'loading' }
    | { type: 'error'; message: string },
): HistoryState => {
  switch (event.type) {
    case 'page':
      return {
        ...prev,
        commits: event.append
          ? [...prev.commits, ...event.page.commits]
          : event.page.commits,
        nextCursor: event.page.nextCursor,
        headSha: event.page.headSha ?? prev.headSha,
        loading: false,
        error: undefined,
      };
    case 'query':
      return {
        ...prev,
        query: event.query,
        commits: [],
        nextCursor: undefined,
      };
    case 'loading':
      return { ...prev, loading: true, error: undefined };
    case 'error':
      return { ...prev, loading: false, error: event.message };
  }
};

export const gitHistoryClient = (relay: RelayLike) => ({
  list: (cwd: string, cursor = 0, limit = 100) =>
    relay.call<GitHistoryPage>(METHODS.LIST_GIT_HISTORY, {
      cwd,
      cursor,
      limit,
    }),
  search: (cwd: string, query: string, cursor = 0, limit = 100) =>
    relay.call<GitHistoryPage>(METHODS.SEARCH_GIT_HISTORY, {
      cwd,
      query,
      cursor,
      limit,
    }),
  avatars: (
    cwd: string,
    authors: { sha: string; email: string }[],
    cursor = 0,
  ) =>
    relay.call<Record<string, string>>(METHODS.RESOLVE_GIT_AVATARS, {
      cwd,
      authors,
      cursor,
      limit: 100,
    }),
  fetchAll: (repoPath: string) => relay.call(METHODS.FETCH_ALL, { repoPath }),
});
